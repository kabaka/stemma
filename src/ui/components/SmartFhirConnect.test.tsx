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
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SmartFhirConnect } from './SmartFhirConnect';
import { useSmartConnectionStore, type SmartConnection } from '@/store/useSmartConnectionStore';
import { buildCatalog } from '@/domain/catalog';
import { emptyRecord } from '@/data/seed';
import {
  conditionResource,
  fhirBundle,
  medicationStatementResource,
  patientResource,
  SYS,
} from '@/import/fixtures/fhir';

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
  // DR-0016: the provider picker is the primary path (lazy-loaded — awaited via `findBy`
  // since it only mounts once its dynamic import resolves), the manual FHIR base URL /
  // Client ID fields remain as the collapsed fallback, and the clinical boundary is intact.
  it('renders the provider picker primary, the manual fallback fields, and the clinical boundary', async () => {
    render(
      <SmartFhirConnect record={record} catalog={catalog} onImport={vi.fn()} onCancel={vi.fn()} />,
    );

    // A generous timeout: this waits on the picker's own `React.lazy` dynamic import
    // resolving, which can take longer than testing-library's 1000ms default under a
    // busy full-suite run (many test files/workers competing for CPU) even though it's
    // near-instant in isolation.
    expect(
      await screen.findByLabelText('Find your provider', {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('FHIR base URL')).toBeInTheDocument();
    expect(screen.getByLabelText('Client ID')).toBeInTheDocument();
    expect(screen.getByRole('note', { name: /clinical boundary/i })).toBeInTheDocument();
  });

  // Regression for DR-0016: Epic fixes redirect URIs at app-registration time (an
  // out-of-band, one-time step for whoever registers Stemma with a provider, not a
  // per-user runtime concern) — the field that used to display/copy it was misleading and
  // is gone. `redirectUri` is still computed internally and still passed to `beginConnect`
  // (see the "calls beginConnect with the entered values…" test below) — only the UI field
  // is removed.
  it('does not render a Redirect URI field', async () => {
    render(
      <SmartFhirConnect record={record} catalog={catalog} onImport={vi.fn()} onCancel={vi.fn()} />,
    );

    // A generous timeout: this waits on the picker's own `React.lazy` dynamic import
    // resolving, which can take longer than testing-library's 1000ms default under a
    // busy full-suite run (many test files/workers competing for CPU) even though it's
    // near-instant in isolation.
    expect(
      await screen.findByLabelText('Find your provider', {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/redirect uri/i)).not.toBeInTheDocument();
    expect(screen.queryByText(redirectUri)).not.toBeInTheDocument();
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

  // Regression for Wave 2/3 (full-timeline import): the "nothing found" short-circuit used to
  // gate on conditions + family history only, so a patient with ONLY health events (meds, labs,
  // etc. — no Condition/FamilyMemberHistory resources at all) was wrongly rejected as empty.
  it('does not reject a sync that found only health events (no conditions, no family history)', async () => {
    const user = userEvent.setup();
    const bundle = fhirBundle([
      patientResource({ id: 'pat-1' }),
      medicationStatementResource({
        id: 'ms1',
        status: 'active',
        medicationCodings: [{ system: SYS.rxnorm, code: '860975', display: 'Metformin' }],
        effectiveDateTime: '2020-05-01',
      }),
    ]);
    useSmartConnectionStore.setState({ syncNow: vi.fn().mockResolvedValue(bundle) });
    render(
      <SmartFhirConnect record={record} catalog={catalog} onImport={vi.fn()} onCancel={vi.fn()} />,
    );

    await user.click(screen.getByRole('button', { name: 'Sync now' }));

    // Must land on the review step (not the "nothing found" sync error) and surface the
    // health event for review.
    expect(await screen.findByRole('heading', { name: 'Health events' })).toBeInTheDocument();
    expect(screen.getByText('Metformin')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(
      screen.getByText(/Synced 0 conditions, 0 family members, and 1 health event/),
    ).toBeInTheDocument();
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

  // Regression suite for the `requestedSyncId` auto-sync latch (see SmartFhirConnect.tsx's
  // `autoSyncedRef` comment): the signal is the seam both a successful OAuth callback AND
  // `SmartSyncChip`'s manual re-sync use, so these assert the sync path is actually invoked
  // by the signal — not just that a piece of state got set — which is the gap that let the
  // stuck-latch bug through originally.
  describe('requestedSyncId auto-sync signal', () => {
    beforeEach(() => {
      useSmartConnectionStore.setState({ requestedSyncId: null });
    });

    it('invokes the sync path exactly once for a valid connection id, and clears the signal', async () => {
      const bundle = fhirBundle([patientResource({ id: 'pat-1' })]);
      const syncNow = vi.fn().mockResolvedValue(bundle);
      useSmartConnectionStore.setState({ syncNow });
      render(
        <SmartFhirConnect
          record={record}
          catalog={catalog}
          onImport={vi.fn()}
          onCancel={vi.fn()}
        />,
      );

      act(() => {
        useSmartConnectionStore.getState().requestSync('conn-1');
      });

      await waitFor(() => expect(syncNow).toHaveBeenCalledTimes(1));
      expect(syncNow).toHaveBeenCalledWith('conn-1');
      await waitFor(() => expect(useSmartConnectionStore.getState().requestedSyncId).toBeNull());
    });

    // The actual regression: before the fix, `autoSyncedRef` latched onto the connection id
    // forever, so a SECOND `requestSync` for the SAME (stable, UUID) connection id — exactly
    // what `SmartSyncChip`'s retry click fires — silently no-opped instead of syncing again.
    it('invokes the sync path again on a second requestSync for the same connection id (chip retry)', async () => {
      const bundle = fhirBundle([patientResource({ id: 'pat-1' })]);
      const syncNow = vi.fn().mockResolvedValue(bundle);
      useSmartConnectionStore.setState({ syncNow });
      render(
        <SmartFhirConnect
          record={record}
          catalog={catalog}
          onImport={vi.fn()}
          onCancel={vi.fn()}
        />,
      );

      act(() => {
        useSmartConnectionStore.getState().requestSync('conn-1');
      });
      await waitFor(() => expect(syncNow).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(useSmartConnectionStore.getState().requestedSyncId).toBeNull());

      act(() => {
        useSmartConnectionStore.getState().requestSync('conn-1');
      });

      await waitFor(() => expect(syncNow).toHaveBeenCalledTimes(2));
    });

    it('clears a requestedSyncId that names a connection which no longer exists, without syncing', async () => {
      const syncNow = vi.fn();
      useSmartConnectionStore.setState({ syncNow });
      render(
        <SmartFhirConnect
          record={record}
          catalog={catalog}
          onImport={vi.fn()}
          onCancel={vi.fn()}
        />,
      );

      act(() => {
        useSmartConnectionStore.getState().requestSync('does-not-exist');
      });

      await waitFor(() => expect(useSmartConnectionStore.getState().requestedSyncId).toBeNull());
      expect(syncNow).not.toHaveBeenCalled();
    });
  });
});
