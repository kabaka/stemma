import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useStore } from '@/store/useStore';
import { useSmartConnectionStore } from '@/store/useSmartConnectionStore';
import type {
  SmartEndpoints,
  SmartFhirGateway,
  TokenResponse,
  TokenStore,
} from '@/integrations/smart-fhir';
import { App } from './App';

beforeEach(() => useStore.getState().resetRecord());

describe('App — navigation', () => {
  it('renders the view matching the current store state and marks its nav item aria-current', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: /health overview/i, level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Overview' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('switching views via the sidebar updates the store, aria-current, and renders the new view', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Family Pedigree' }));

    expect(useStore.getState().view).toBe('tree');
    expect(screen.getByRole('button', { name: 'Family Pedigree' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('heading', { name: /family pedigree/i, level: 1 })).toBeInTheDocument();
    // The previous view's page is gone — each view swap unmounts the old one.
    expect(screen.queryByRole('heading', { name: /health overview/i })).not.toBeInTheDocument();
  });

  it("routes every nav item to its own view (App's full view === ... switch table)", async () => {
    const user = userEvent.setup();
    render(<App />);
    const cases: [navLabel: string, view: string, headingPattern: RegExp][] = [
      ['Family Patterns', 'patterns', /family patterns/i],
      ['My Timeline', 'timeline', /my health timeline/i],
      ['Reports & Export', 'reports', /reports & export/i],
      ['History', 'history', /^history$/i],
      ['Family Pedigree', 'tree', /family pedigree/i],
      ['Overview', 'overview', /health overview/i],
    ];
    for (const [navLabel, view, headingPattern] of cases) {
      await user.click(screen.getByRole('button', { name: navLabel }));
      expect(useStore.getState().view).toBe(view);
      expect(screen.getByRole('heading', { name: headingPattern, level: 1 })).toBeInTheDocument();
    }
  });

  it('does not steal focus to the heading on first render, but moves it there on navigation (WCAG 2.4.3)', async () => {
    const user = userEvent.setup();
    render(<App />);
    // Skipped on the very first render — nothing has forced focus onto the page heading.
    expect(document.body).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'My Timeline' }));
    // Every subsequent navigation moves focus to the new view's own <h1>.
    expect(screen.getByRole('heading', { name: /my health timeline/i, level: 1 })).toHaveFocus();
  });
});

describe('App — StrictMode focus safety (regression)', () => {
  // [HIGH, review-gate] The old code tracked "is this the first render" with a plain
  // `useRef(true)` boolean latch, flipped to false inside the focus effect. React 18
  // StrictMode (dev only) mounts every effect-bearing component, immediately fake-
  // unmounts it (running cleanups) and fake-remounts it (rerunning effects) once, all
  // using the SAME component instance and hook state — so that boolean flipped to
  // `false` during the throwaway cycle, and the real mount that followed (still the same
  // initial `view`) found the latch already spent and wrongly focused the page heading on
  // first load. A plain, non-StrictMode `render(<App/>)` (see the "does not steal focus…"
  // test above) never exercises this — only wrapping in `<React.StrictMode>` reproduces
  // dev-mode's double-invoke and would have caught the regression.
  beforeEach(() => useStore.getState().setView('overview'));

  it('does not steal focus to the page heading on initial mount under StrictMode', () => {
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    expect(document.body).toHaveFocus();
    expect(screen.getByRole('heading', { name: /health overview/i, level: 1 })).not.toHaveFocus();
  });

  it('still moves focus to the new view’s heading on a real navigation under StrictMode', async () => {
    const user = userEvent.setup();
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    await user.click(screen.getByRole('button', { name: 'My Timeline' }));
    expect(screen.getByRole('heading', { name: /my health timeline/i, level: 1 })).toHaveFocus();
  });
});

describe('App — SMART-on-FHIR OAuth callback effect (StrictMode double-mount safety)', () => {
  // The real, unmodified ports — captured once so `afterEach` can restore the singleton store to
  // them, never leaking a fake gateway/tokenStore into any test that runs after this block.
  const realGateway = useSmartConnectionStore.getState().gateway;
  const realTokenStore = useSmartConnectionStore.getState().tokenStore;

  const ENDPOINTS: SmartEndpoints = {
    authorizeEndpoint: 'https://ehr.example.org/oauth2/authorize',
    tokenEndpoint: 'https://ehr.example.org/oauth2/token',
  };
  let originalLocation: Location;

  // jsdom's real Location throws "not implemented" on `.assign()` navigation and disallows
  // redefining it via `vi.spyOn` — a full property replacement is the supported way to intercept
  // it without a real page load (same technique as `useSmartConnectionStore.test.ts`).
  function setLocation(
    overrides: { search?: string; assign?: ReturnType<typeof vi.fn> } = {},
  ): void {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: {
        origin: 'http://localhost:3000',
        pathname: '/',
        search: overrides.search ?? '',
        assign: overrides.assign ?? vi.fn(),
      },
    });
  }

  function fakeGateway(overrides: Partial<SmartFhirGateway> = {}): SmartFhirGateway {
    return {
      discover: vi.fn<SmartFhirGateway['discover']>().mockResolvedValue(ENDPOINTS),
      exchangeCode: vi.fn<SmartFhirGateway['exchangeCode']>().mockResolvedValue({
        access_token: 'AT-1',
        token_type: 'Bearer',
        expires_in: 3600,
        patient: 'pat-1',
      } satisfies TokenResponse),
      refresh: vi
        .fn<SmartFhirGateway['refresh']>()
        .mockResolvedValue({ access_token: 'AT-2', token_type: 'Bearer', expires_in: 3600 }),
      fetchPatientData: vi
        .fn<SmartFhirGateway['fetchPatientData']>()
        .mockResolvedValue({ resourceType: 'Bundle', entry: [] }),
      ...overrides,
    };
  }

  function fakeTokenStore(): TokenStore {
    return {
      saveAccessToken: vi.fn<TokenStore['saveAccessToken']>(),
      getAccessToken: vi.fn<TokenStore['getAccessToken']>().mockReturnValue(null),
      saveRefreshToken: vi.fn<TokenStore['saveRefreshToken']>(),
      getRefreshToken: vi.fn<TokenStore['getRefreshToken']>().mockReturnValue(null),
      clear: vi.fn<TokenStore['clear']>(),
    };
  }

  /** Drive the real `beginConnect` to legitimately establish a pending handshake in
   * `sessionStorage`, and capture the `state` it generated from the authorize URL — without
   * hardcoding the store's private `sessionStorage` key. */
  async function establishPendingCallback(gateway: SmartFhirGateway): Promise<string> {
    const assign = vi.fn();
    setLocation({ assign });
    useSmartConnectionStore.getState().configure({ gateway, tokenStore: fakeTokenStore() });
    await useSmartConnectionStore
      .getState()
      .beginConnect('https://ehr.example.org/fhir', 'stemma-app');
    const url = new URL(assign.mock.calls[0][0] as string);
    return url.searchParams.get('state')!;
  }

  beforeEach(() => {
    originalLocation = window.location;
    window.sessionStorage.clear();
    window.localStorage.clear();
    setLocation();
    useSmartConnectionStore.setState({ connections: [], callbackError: null });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
    useSmartConnectionStore.setState({
      gateway: realGateway,
      tokenStore: realTokenStore,
      connections: [],
      callbackError: null,
    });
  });

  it('under StrictMode double-mount, the OAuth callback is exchanged at most once', async () => {
    const gateway = fakeGateway();
    const state = await establishPendingCallback(gateway);
    setLocation({ search: `?code=AUTH-CODE&state=${state}` });
    useSmartConnectionStore.getState().configure({ gateway, tokenStore: fakeTokenStore() });

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    await waitFor(() => expect(useSmartConnectionStore.getState().connections).toHaveLength(1));
    // Give any second (erroneous) invocation the same chance to have resolved before counting.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(gateway.exchangeCode).toHaveBeenCalledTimes(1);
  });

  it('a failed callback (state mismatch) leaves callbackError set for the UI to render', async () => {
    const gateway = fakeGateway();
    await establishPendingCallback(gateway);
    // Deliberately the wrong state — the pending handshake's real state is discarded.
    setLocation({ search: '?code=AUTH-CODE&state=totally-wrong-state' });
    useSmartConnectionStore.getState().configure({ gateway, tokenStore: fakeTokenStore() });

    render(<App />);

    await waitFor(() =>
      expect(useSmartConnectionStore.getState().callbackError).toMatch(/state mismatch/i),
    );
    expect(gateway.exchangeCode).not.toHaveBeenCalled();
  });
});
