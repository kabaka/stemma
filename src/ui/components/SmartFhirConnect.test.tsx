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
import { inferVendor, SmartFhirConnect } from './SmartFhirConnect';
import { useSmartConnectionStore, type SmartConnection } from '@/store/useSmartConnectionStore';
import { buildCatalog } from '@/domain/catalog';
import { emptyRecord } from '@/data/seed';
import { SMART_PROVIDERS } from '@/data/smart-endpoints';
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
  // `vi.stubEnv` (used by the vendor-aware client id tests below) must not leak between
  // tests — `buildTimeClientId` (see src/ui/config.ts) is called fresh on every render, not
  // cached at module load, so a lingering stub would silently affect unrelated tests.
  vi.unstubAllEnvs();
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

// Regression for the security-hardening finding: `inferVendor` used to test the whole URL
// STRING against a `cerner.com` substring, so a crafted host could spoof the Cerner vendor
// (attaching the Cerner client id to an attacker-controlled origin and suppressing the
// manual-entry prompt for a build that only has Epic's Variable set). It must parse the real
// hostname instead.
describe('inferVendor', () => {
  it('infers cerner for a real Cerner/Oracle Health host', () => {
    expect(inferVendor(null, 'https://fhir-myrecord.cerner.com/r4/some-tenant/')).toBe('cerner');
  });

  it('does NOT infer cerner for a look-alike host with cerner.com as a subdomain prefix', () => {
    expect(inferVendor(null, 'https://cerner.com.evil.example/fhir')).toBe('epic');
  });

  it('does NOT infer cerner for cerner.com appearing only in the path', () => {
    expect(inferVendor(null, 'https://evil.example/path/cerner.com')).toBe('epic');
  });

  it('infers epic for a real Epic-style host', () => {
    expect(inferVendor(null, 'https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4')).toBe(
      'epic',
    );
  });

  it('defaults to epic for a non-URL (not-yet-parseable) string', () => {
    expect(inferVendor(null, 'not a url')).toBe('epic');
    expect(inferVendor(null, '')).toBe('epic');
  });

  it('a picked selectedSource is authoritative over whatever the URL would infer', () => {
    expect(inferVendor('epic', 'https://fhir-myrecord.cerner.com/r4/some-tenant/')).toBe('epic');
    expect(inferVendor('cerner', 'https://fhir.epic.com/api/FHIR/R4')).toBe('cerner');
  });
});

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

// Multi-vendor (Epic + Cerner/Oracle Health) client id resolution: each vendor has its own
// build-time client id (see src/ui/config.ts), resolved from whichever provider is ACTIVE —
// a directory pick is authoritative, a manually-typed URL is inferred from its host — so the
// same build can serve both vendors, each with the right id, and the manual Client ID field
// only appears for whichever vendor's Variable this build doesn't have set.
describe('SmartFhirConnect — vendor-aware client id', () => {
  const epicTarget = SMART_PROVIDERS.find((p) => p.source === 'epic')!;
  const cernerTarget = SMART_PROVIDERS.find((p) => p.source === 'cerner')!;

  async function pick(
    user: ReturnType<typeof userEvent.setup>,
    input: HTMLElement,
    target: (typeof SMART_PROVIDERS)[number],
  ): Promise<void> {
    // Clear first — a prior pick leaves the input holding the FULL selected name (see
    // `select()` in ProviderPicker.tsx), and userEvent.type appends rather than replacing.
    await user.clear(input);
    await user.type(input, target.name.slice(0, 8));
    const options = await screen.findAllByRole('option');
    const option = options.find((o) => o.textContent?.includes(target.name));
    expect(option).toBeDefined();
    await user.click(option!);
  }

  it('picking an Epic provider calls beginConnect with the build-time Epic client id', async () => {
    vi.stubEnv('VITE_EPIC_CLIENT_ID', 'epic-build-id');
    const user = userEvent.setup();
    const beginConnect = vi.fn().mockResolvedValue(undefined);
    useSmartConnectionStore.setState({ beginConnect });
    render(
      <SmartFhirConnect record={record} catalog={catalog} onImport={vi.fn()} onCancel={vi.fn()} />,
    );

    const input = await screen.findByLabelText('Find your provider', {}, { timeout: 5000 });
    await pick(user, input, epicTarget);
    await user.click(screen.getByRole('button', { name: 'Connect' }));

    expect(beginConnect).toHaveBeenCalledWith(epicTarget.fhirBaseUrl, 'epic-build-id', {
      stayConnected: false,
      redirectUri,
    });
  });

  it('picking a Cerner provider calls beginConnect with the build-time Cerner client id', async () => {
    vi.stubEnv('VITE_CERNER_CLIENT_ID', 'cerner-build-id');
    const user = userEvent.setup();
    const beginConnect = vi.fn().mockResolvedValue(undefined);
    useSmartConnectionStore.setState({ beginConnect });
    render(
      <SmartFhirConnect record={record} catalog={catalog} onImport={vi.fn()} onCancel={vi.fn()} />,
    );

    const input = await screen.findByLabelText('Find your provider', {}, { timeout: 5000 });
    await pick(user, input, cernerTarget);
    await user.click(screen.getByRole('button', { name: 'Connect' }));

    expect(beginConnect).toHaveBeenCalledWith(cernerTarget.fhirBaseUrl, 'cerner-build-id', {
      stayConnected: false,
      redirectUri,
    });
  });

  it('a manually-typed cerner.com FHIR base URL infers the Cerner vendor and its client id', async () => {
    vi.stubEnv('VITE_CERNER_CLIENT_ID', 'cerner-build-id');
    vi.stubEnv('VITE_EPIC_CLIENT_ID', 'epic-build-id');
    const user = userEvent.setup();
    const beginConnect = vi.fn().mockResolvedValue(undefined);
    useSmartConnectionStore.setState({ beginConnect });
    render(
      <SmartFhirConnect record={record} catalog={catalog} onImport={vi.fn()} onCancel={vi.fn()} />,
    );
    await screen.findByLabelText('Find your provider', {}, { timeout: 5000 });

    await user.type(
      screen.getByLabelText('FHIR base URL'),
      'https://fhir-myrecord.cerner.com/r4/some-tenant/',
    );
    await user.click(screen.getByRole('button', { name: 'Connect' }));

    expect(beginConnect).toHaveBeenCalledWith(
      'https://fhir-myrecord.cerner.com/r4/some-tenant/',
      'cerner-build-id',
      { stayConnected: false, redirectUri },
    );
  });

  // Regression for the security-hardening finding: a look-alike host must NOT be misattributed
  // to Cerner (which would attach the Cerner client id to an attacker-controlled origin and
  // wrongly suppress the manual-entry field for a build that only has Epic's Variable set).
  it('does not misclassify a cerner.com look-alike host as Cerner, and still surfaces the manual field', async () => {
    vi.stubEnv('VITE_CERNER_CLIENT_ID', 'cerner-build-id');
    // VITE_EPIC_CLIENT_ID intentionally left unset — Epic is the active (inferred) vendor for
    // this URL, so the manual field must appear.
    const user = userEvent.setup();
    const beginConnect = vi.fn().mockResolvedValue(undefined);
    useSmartConnectionStore.setState({ beginConnect });
    render(
      <SmartFhirConnect record={record} catalog={catalog} onImport={vi.fn()} onCancel={vi.fn()} />,
    );
    await screen.findByLabelText('Find your provider', {}, { timeout: 5000 });

    await user.type(screen.getByLabelText('FHIR base URL'), 'https://cerner.com.evil.example/fhir');
    expect(await screen.findByLabelText('Client ID')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Client ID'), 'manually-entered-id');
    await user.click(screen.getByRole('button', { name: 'Connect' }));

    expect(beginConnect).toHaveBeenCalledWith(
      'https://cerner.com.evil.example/fhir',
      'manually-entered-id',
      { stayConnected: false, redirectUri },
    );
  });

  // Regression for the a11y finding (WCAG 4.1.3): the manual Client ID field used to appear
  // with no announcement — focus stays in the picker/URL field the whole time, so a
  // screen-reader user was never told a new required field showed up. The field must live
  // inside an always-mounted `role="status"` region so its insertion is announced, and the
  // hint text must name the active vendor (FIX 6) so the announcement is actionable.
  it('announces the manual Client ID field appearing via a role="status" region naming the active vendor', async () => {
    vi.stubEnv('VITE_EPIC_CLIENT_ID', 'epic-build-id');
    // VITE_CERNER_CLIENT_ID intentionally left unset. Epic starts as the active vendor (no
    // pick, no typed URL yet) and Epic's Variable IS set here, so the field (and its
    // announcement) should NOT be present yet.
    const user = userEvent.setup();
    render(
      <SmartFhirConnect record={record} catalog={catalog} onImport={vi.fn()} onCancel={vi.fn()} />,
    );

    const input = await screen.findByLabelText('Find your provider', {}, { timeout: 5000 });
    expect(screen.queryByLabelText('Client ID')).not.toBeInTheDocument();

    await pick(user, input, cernerTarget);

    // The field now lives inside a `role="status"` live region (queried by plain DOM
    // ancestry, not testing-library's role/name matcher — `role="status"` computes no
    // accessible name from content per the ARIA spec, and `syncStatus`'s own always-mounted
    // `role="status"` paragraph elsewhere in this form means a bare `getByRole('status')`
    // would match more than one element), and the region's own text names the newly-active
    // vendor — both together are what makes the appearance an actionable, announced event
    // rather than a silent DOM insertion.
    const clientIdInput = await screen.findByLabelText('Client ID');
    const statusRegion = clientIdInput.closest('[role="status"]');
    expect(statusRegion).not.toBeNull();
    expect(statusRegion!).toHaveTextContent(
      /this provider needs a client id you register yourself/i,
    );
    expect(statusRegion!).toHaveTextContent(/register stemma with oracle health/i);
  });

  it('shows the manual Client ID field only for the active vendor when its Variable is unset, and hides it once that vendor has one', async () => {
    vi.stubEnv('VITE_EPIC_CLIENT_ID', 'epic-build-id');
    // VITE_CERNER_CLIENT_ID intentionally left unset.
    const user = userEvent.setup();
    render(
      <SmartFhirConnect record={record} catalog={catalog} onImport={vi.fn()} onCancel={vi.fn()} />,
    );

    const input = await screen.findByLabelText('Find your provider', {}, { timeout: 5000 });
    // No provider picked yet and no URL typed — the active vendor defaults to Epic, whose
    // Variable IS set here, so the manual field must not appear.
    expect(screen.queryByLabelText('Client ID')).not.toBeInTheDocument();

    // Picking a Cerner provider flips the active vendor to Cerner, whose Variable is unset —
    // the manual field must now appear.
    await pick(user, input, cernerTarget);
    expect(await screen.findByLabelText('Client ID')).toBeInTheDocument();

    // Picking an Epic provider next flips back — the field must hide again.
    await pick(user, input, epicTarget);
    expect(screen.queryByLabelText('Client ID')).not.toBeInTheDocument();
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
