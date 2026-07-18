/**
 * Component test for {@link SmartFhirConnect} — the UI layer's own responsibility (form
 * validation, error copy, the connected-status rendering, and running `parseFhirImport` +
 * staging on `syncNow`'s result before handing it to the reused `CcdaReview`).
 * `useSmartConnectionStore`'s own OAuth/token behavior is that store's oracle, not this
 * file's — every store action here is mocked out (per CLAUDE.md's "mock the store" guidance
 * for frontend-engineer tests) so this suite never touches the network or
 * `window.location.assign`. The store hands back a RAW `FhirImportBundle` (it deliberately
 * doesn't import the `src/import` layer — see useSmartConnectionStore's own layering note);
 * `syncNow` is mocked to resolve one built from the real fixture helpers below, and
 * `parseFhirImport` runs for real inside the component, so this suite exercises the actual
 * parse→stage pipeline rather than fabricating a `ParsedHealthRecord` by hand.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SmartFhirConnect } from './SmartFhirConnect';
import { useSmartConnectionStore, type SmartConnection } from '@/store/useSmartConnectionStore';
import { buildCatalog } from '@/domain/catalog';
import { emptyRecord } from '@/data/seed';
import { conditionResource, fhirBundle, patientResource, SYS } from '@/import/fixtures/fhir';

const catalog = buildCatalog([]);
const record = emptyRecord();
const redirectUri = `${window.location.origin}${import.meta.env.BASE_URL}`;

// Capture the real store actions once so each test can install its own `vi.fn()` mocks (this
// component must never actually reach the network or navigate the page) and every test still
// leaves the shared store in its real, working shape for whichever test runs next.
const realActions = {
  beginConnect: useSmartConnectionStore.getState().beginConnect,
  syncNow: useSmartConnectionStore.getState().syncNow,
  disconnect: useSmartConnectionStore.getState().disconnect,
  setStayConnected: useSmartConnectionStore.getState().setStayConnected,
  clearCallbackError: useSmartConnectionStore.getState().clearCallbackError,
};

beforeEach(() => {
  useSmartConnectionStore.setState({ connections: [], callbackError: null, ...realActions });
});
afterEach(() => {
  useSmartConnectionStore.setState({ connections: [], callbackError: null, ...realActions });
});

const CONNECTION: SmartConnection = {
  id: 'conn-1',
  fhirBaseUrl: 'https://fhir.example.org/api/FHIR/R4',
  authorizeEndpoint: 'https://fhir.example.org/oauth/authorize',
  tokenEndpoint: 'https://fhir.example.org/oauth/token',
  clientId: 'stemma-test-client',
  patientId: 'pat-1',
  scopesGranted: ['openid', 'fhirUser', 'patient/Condition.read'],
  offlineAccessGranted: false,
  stayConnected: false,
  lastSyncAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('SmartFhirConnect — not connected', () => {
  it('renders the connect form with the exact registrable redirect URI and the clinical boundary', () => {
    render(
      <SmartFhirConnect record={record} catalog={catalog} onImport={vi.fn()} onCancel={vi.fn()} />,
    );

    expect(screen.getByLabelText('FHIR base URL')).toBeInTheDocument();
    expect(screen.getByLabelText('Client ID')).toBeInTheDocument();
    expect(
      screen.getByRole('textbox', { name: 'Redirect URI to register with your provider' }),
    ).toHaveValue(redirectUri);
    expect(screen.getByRole('note', { name: /clinical boundary/i })).toBeInTheDocument();
  });

  // Regression for the reviewer-identified BLOCKER: the redirect URI used to render as a
  // <code> block, which a keyboard user can neither focus nor select text from. It must now
  // be a real, read-only, natively-focusable/selectable textbox — the Copy button stays as
  // the one-step convenience path, not the only way to get the value.
  it('renders the redirect URI as a read-only, keyboard-focusable textbox (not a <code> block)', () => {
    render(
      <SmartFhirConnect record={record} catalog={catalog} onImport={vi.fn()} onCancel={vi.fn()} />,
    );

    const input = screen.getByRole('textbox', {
      name: 'Redirect URI to register with your provider',
    });
    expect(input.tagName).toBe('INPUT');
    expect(input).toHaveAttribute('readonly');
    expect(input).toHaveValue(redirectUri);
  });

  // Regression for the reviewer-identified re-entrancy bug: `aria-disabled` doesn't stop a
  // second click from firing the handler while the first `beginConnect` call is still
  // in flight, so `handleConnect` must guard itself explicitly (mirrors
  // CcdaReview.handleConfirmClick's own early-return guard).
  it('does not call beginConnect twice on a rapid double-click while connecting', async () => {
    const user = userEvent.setup();
    const beginConnect = vi.fn(() => new Promise<void>(() => {})); // never resolves
    useSmartConnectionStore.setState({ beginConnect });
    render(
      <SmartFhirConnect record={record} catalog={catalog} onImport={vi.fn()} onCancel={vi.fn()} />,
    );

    await user.type(screen.getByLabelText('FHIR base URL'), 'https://fhir.example.org/R4');
    await user.type(screen.getByLabelText('Client ID'), 'my-client-id');
    const connectBtn = screen.getByRole('button', { name: 'Connect' });
    await user.click(connectBtn);
    await user.click(connectBtn); // still "Connecting…" — must be a no-op

    expect(beginConnect).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-https FHIR base URL without calling beginConnect', async () => {
    const user = userEvent.setup();
    const beginConnect = vi.fn();
    useSmartConnectionStore.setState({ beginConnect });
    render(
      <SmartFhirConnect record={record} catalog={catalog} onImport={vi.fn()} onCancel={vi.fn()} />,
    );

    await user.type(screen.getByLabelText('FHIR base URL'), 'http://fhir.example.org/R4');
    await user.type(screen.getByLabelText('Client ID'), 'my-client-id');
    await user.click(screen.getByRole('button', { name: 'Connect' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/https/i);
    expect(beginConnect).not.toHaveBeenCalled();
  });

  it('rejects an empty submission without calling beginConnect', async () => {
    const user = userEvent.setup();
    const beginConnect = vi.fn();
    useSmartConnectionStore.setState({ beginConnect });
    render(
      <SmartFhirConnect record={record} catalog={catalog} onImport={vi.fn()} onCancel={vi.fn()} />,
    );

    await user.click(screen.getByRole('button', { name: 'Connect' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/enter both/i);
    expect(beginConnect).not.toHaveBeenCalled();
  });

  it('calls beginConnect with the entered values, the opt-in, and the displayed redirect URI', async () => {
    const user = userEvent.setup();
    const beginConnect = vi.fn().mockResolvedValue(undefined);
    useSmartConnectionStore.setState({ beginConnect });
    render(
      <SmartFhirConnect record={record} catalog={catalog} onImport={vi.fn()} onCancel={vi.fn()} />,
    );

    await user.type(screen.getByLabelText('FHIR base URL'), 'https://fhir.example.org/R4');
    await user.type(screen.getByLabelText('Client ID'), 'my-client-id');
    await user.click(screen.getByRole('checkbox', { name: /stay connected on this device/i }));
    await user.click(screen.getByRole('button', { name: 'Connect' }));

    expect(beginConnect).toHaveBeenCalledWith('https://fhir.example.org/R4', 'my-client-id', {
      stayConnected: true,
      redirectUri,
    });
  });

  it('shows CORS/network guidance when beginConnect fails with a bare fetch failure', async () => {
    const user = userEvent.setup();
    useSmartConnectionStore.setState({
      beginConnect: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    });
    render(
      <SmartFhirConnect record={record} catalog={catalog} onImport={vi.fn()} onCancel={vi.fn()} />,
    );

    await user.type(screen.getByLabelText('FHIR base URL'), 'https://fhir.example.org/R4');
    await user.type(screen.getByLabelText('Client ID'), 'my-client-id');
    await user.click(screen.getByRole('button', { name: 'Connect' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/CORS/i);
  });

  // Regression for the reviewer-identified BLOCKER: the OAuth redirect back from the
  // provider is a full page reload, so a failed callback can only reach the user through
  // `callbackError` persisted in the store — this is the sole path that surfaces it.
  it('renders a persisted callbackError through the friendly-error copy, with a working dismiss', async () => {
    const user = userEvent.setup();
    const clearCallbackError = vi.fn();
    useSmartConnectionStore.setState({
      callbackError: 'state mismatch',
      clearCallbackError,
    });
    render(
      <SmartFhirConnect record={record} catalog={catalog} onImport={vi.fn()} onCancel={vi.fn()} />,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be verified/i);

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(clearCallbackError).toHaveBeenCalledTimes(1);
  });
});

describe('SmartFhirConnect — connected', () => {
  beforeEach(() => {
    useSmartConnectionStore.setState({ connections: [CONNECTION] });
  });

  it('shows the provider, scopes, and the no-unattended-access explanation', () => {
    render(
      <SmartFhirConnect record={record} catalog={catalog} onImport={vi.fn()} onCancel={vi.fn()} />,
    );

    expect(screen.getByText(CONNECTION.fhirBaseUrl)).toBeInTheDocument();
    expect(screen.getByText(CONNECTION.scopesGranted.join(', '))).toBeInTheDocument();
    expect(screen.getByText('Never')).toBeInTheDocument(); // lastSyncAt === null
    expect(screen.getByText(/ask you to sign in with them first/i)).toBeInTheDocument();
  });

  it('disconnecting calls the store action with the connection id', async () => {
    const user = userEvent.setup();
    const disconnect = vi.fn();
    useSmartConnectionStore.setState({ disconnect });
    render(
      <SmartFhirConnect record={record} catalog={catalog} onImport={vi.fn()} onCancel={vi.fn()} />,
    );

    await user.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(disconnect).toHaveBeenCalledWith('conn-1');
  });

  it('syncing stages the parsed record into the reused review UI, and confirming applies it', async () => {
    const user = userEvent.setup();
    // syncNow now resolves the RAW FhirImportBundle (the store no longer imports the
    // `src/import` layer) — SmartFhirConnect itself runs parseFhirImport on it, using
    // `pat-1` from CONNECTION.patientId. Not faking the bundle keeps this exercising the
    // real parser rather than risking drift from its actual shape.
    const bundle = fhirBundle([
      patientResource({ id: 'pat-1' }),
      conditionResource({
        id: 'c1',
        verificationStatus: 'confirmed',
        codings: [{ system: SYS.icd10cm, code: 'E11.9', display: 'Type 2 diabetes' }],
      }),
    ]);
    useSmartConnectionStore.setState({ syncNow: vi.fn().mockResolvedValue(bundle) });
    const onImport = vi.fn();
    render(
      <SmartFhirConnect record={record} catalog={catalog} onImport={onImport} onCancel={vi.fn()} />,
    );

    await user.click(screen.getByRole('button', { name: 'Sync now' }));

    expect(await screen.findByText('Your conditions')).toBeInTheDocument();
    expect(screen.getByRole('note', { name: /clinical boundary/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /import selected items/i }));

    expect(onImport).toHaveBeenCalledTimes(1);
    const [mergedRecord] = onImport.mock.calls[0];
    // 'E11.9' (ICD-10-CM) resolves to the curated catalog's own slug id for Type 2 diabetes
    // ('t2d', see src/data/conditions.ts) — the merge attaches the curated id, not the raw code.
    expect(mergedRecord.people[0].conds.some((c: { id: string }) => c.id === 't2d')).toBe(true);
  });

  // Regression for the reviewer-identified BLOCKER: `useDisclosureFocus` only fires on
  // mount, so swapping this component's own internal step from the connect form to the
  // sync-review step (without unmounting the component) used to drop focus to <body> when
  // the previously-focused "Sync now" button unmounted. `useFocusOnChange` must move focus
  // to the review step's own heading on that transition.
  it('moves focus to the "Review synced health record" heading after a successful sync', async () => {
    const user = userEvent.setup();
    const bundle = fhirBundle([
      patientResource({ id: 'pat-1' }),
      conditionResource({
        id: 'c1',
        verificationStatus: 'confirmed',
        codings: [{ system: SYS.icd10cm, code: 'E11.9', display: 'Type 2 diabetes' }],
      }),
    ]);
    useSmartConnectionStore.setState({ syncNow: vi.fn().mockResolvedValue(bundle) });
    render(
      <SmartFhirConnect record={record} catalog={catalog} onImport={vi.fn()} onCancel={vi.fn()} />,
    );

    await user.click(screen.getByRole('button', { name: 'Sync now' }));

    const heading = await screen.findByRole('heading', { name: 'Review synced health record' });
    expect(heading).toHaveFocus();
  });

  // Regression for the reviewer-identified re-entrancy bug on the sync side — same guard
  // shape as the connect-side test above.
  it('does not call syncNow twice on a rapid double-click on Sync now', async () => {
    const user = userEvent.setup();
    const syncNow = vi.fn(() => new Promise<never>(() => {})); // never resolves
    useSmartConnectionStore.setState({ syncNow });
    render(
      <SmartFhirConnect record={record} catalog={catalog} onImport={vi.fn()} onCancel={vi.fn()} />,
    );

    const syncBtn = screen.getByRole('button', { name: 'Sync now' });
    await user.click(syncBtn);
    await user.click(syncBtn); // still "Syncing…" — must be a no-op

    expect(syncNow).toHaveBeenCalledTimes(1);
  });

  it('shows a per-connection sync error without losing the connection card', async () => {
    const user = userEvent.setup();
    useSmartConnectionStore.setState({
      syncNow: vi.fn().mockRejectedValue(new Error('Token request failed: 400 Bad Request')),
    });
    render(
      <SmartFhirConnect record={record} catalog={catalog} onImport={vi.fn()} onCancel={vi.fn()} />,
    );

    await user.click(screen.getByRole('button', { name: 'Sync now' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /sign-in with this provider failed/i,
    );
    expect(screen.getByText(CONNECTION.fhirBaseUrl)).toBeInTheDocument();
  });
});
