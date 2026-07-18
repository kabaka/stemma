/**
 * Component test for {@link SmartFhirConnect} — the UI layer's own responsibility (form
 * validation, error copy, the connected-status rendering, and wiring `syncNow`'s result into
 * the reused `CcdaReview`). `useSmartConnectionStore`'s own OAuth/token behavior is that store's
 * oracle, not this file's — every store action here is mocked out (per CLAUDE.md's "mock the
 * store" guidance for frontend-engineer tests) so this suite never touches the network or
 * `window.location.assign`. `parseFhirImport` is exercised for real (not faked) to produce the
 * `ParsedHealthRecord` the sync test stages, since fabricating one by hand would risk drifting
 * from the real parser's shape.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SmartFhirConnect } from './SmartFhirConnect';
import { useSmartConnectionStore, type SmartConnection } from '@/store/useSmartConnectionStore';
import { parseFhirImport } from '@/import';
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
};

beforeEach(() => {
  useSmartConnectionStore.setState({ connections: [], ...realActions });
});
afterEach(() => {
  useSmartConnectionStore.setState({ connections: [], ...realActions });
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
    expect(screen.getByText(redirectUri)).toBeInTheDocument();
    expect(screen.getByRole('note', { name: /clinical boundary/i })).toBeInTheDocument();
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
    const parsed = parseFhirImport(
      fhirBundle([
        patientResource({ id: 'pat-1' }),
        conditionResource({
          id: 'c1',
          verificationStatus: 'confirmed',
          codings: [{ system: SYS.icd10cm, code: 'E11.9', display: 'Type 2 diabetes' }],
        }),
      ]),
      { patientId: 'pat-1' },
    );
    useSmartConnectionStore.setState({ syncNow: vi.fn().mockResolvedValue(parsed) });
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
