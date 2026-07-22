/**
 * Oracle for `src/store/useSmartConnectionStore.ts` — the ONLY code path that drives the SMART
 * OAuth gateway + token store. This is the CSRF/token invariant surface flagged by the security +
 * code reviews as untested: state-mismatch rejection, the in-flight re-entrancy latch (the belt
 * half of the belt-and-braces pair with `App.tsx`'s own `useRef` latch — see the StrictMode test
 * there), the "clear pending + scrub the URL no matter what" `finally`, and the
 * persist-refresh-token-only-when-opted-in policy.
 *
 * Determinism: the injected `gateway`/`tokenStore` are fakes (never a real network call, never a
 * real Web Storage secret beyond the in-memory fakes below); `window.location`/`window.history`
 * are driven through jsdom's real, well-supported `Object.defineProperty`/`pushState` seams rather
 * than a real navigation. PKCE's `codeVerifier`/`state` ARE generated via the real
 * `crypto.getRandomValues`/`crypto.subtle` (there is no injection seam on `beginConnect` itself) —
 * but no assertion below depends on knowing those opaque values in advance; every assertion is
 * either a call-count/call-shape check or a round-trip equality against a value this same test
 * captured, so the suite's pass/fail is fully deterministic regardless of the actual random bytes.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { useSmartConnectionStore } from './useSmartConnectionStore';
import type { SmartConnection } from './useSmartConnectionStore';
import { useStore } from './useStore';
import type {
  AccessTokenRecord,
  FhirImportBundle,
  SmartEndpoints,
  SmartFhirGateway,
  TokenResponse,
  TokenStore,
} from '@/integrations/smart-fhir';

const ENDPOINTS: SmartEndpoints = {
  authorizeEndpoint: 'https://ehr.example.org/oauth2/authorize',
  tokenEndpoint: 'https://ehr.example.org/oauth2/token',
};

// ---------------------------------------------------------------------------
// Fakes — injected via the store's `configure()` seam, never the real network/storage. Each mock
// is generic-typed to its exact port method signature (not the bare `ReturnType<typeof vi.fn>`)
// so the fake structurally satisfies `SmartFhirGateway`/`TokenStore` under `tsc`, while still
// exposing `.mock.calls` / `toHaveBeenCalledWith` for assertions.
// ---------------------------------------------------------------------------

interface FakeGateway extends SmartFhirGateway {
  discover: Mock<SmartFhirGateway['discover']>;
  exchangeCode: Mock<SmartFhirGateway['exchangeCode']>;
  refresh: Mock<SmartFhirGateway['refresh']>;
  fetchPatientData: Mock<SmartFhirGateway['fetchPatientData']>;
}

function fakeGateway(overrides: Partial<FakeGateway> = {}): FakeGateway {
  return {
    discover: vi.fn<SmartFhirGateway['discover']>().mockResolvedValue(ENDPOINTS),
    exchangeCode: vi.fn<SmartFhirGateway['exchangeCode']>().mockResolvedValue({
      access_token: 'AT-exchanged',
      token_type: 'Bearer',
      expires_in: 3600,
      patient: 'pat-1',
    } satisfies TokenResponse),
    refresh: vi.fn<SmartFhirGateway['refresh']>().mockResolvedValue({
      access_token: 'AT-refreshed',
      token_type: 'Bearer',
      expires_in: 3600,
    } satisfies TokenResponse),
    fetchPatientData: vi
      .fn<SmartFhirGateway['fetchPatientData']>()
      .mockResolvedValue({ resourceType: 'Bundle', entry: [] } satisfies FhirImportBundle),
    ...overrides,
  };
}

interface FakeTokenStore extends TokenStore {
  saveAccessToken: Mock<TokenStore['saveAccessToken']>;
  getAccessToken: Mock<TokenStore['getAccessToken']>;
  saveRefreshToken: Mock<TokenStore['saveRefreshToken']>;
  getRefreshToken: Mock<TokenStore['getRefreshToken']>;
  clear: Mock<TokenStore['clear']>;
  /** Test-only seam to pre-seed an access/refresh token without going through save*. */
  _seedAccess: (id: string, record: AccessTokenRecord) => void;
  _seedRefresh: (id: string, token: string) => void;
}

function fakeTokenStore(): FakeTokenStore {
  const access = new Map<string, AccessTokenRecord>();
  const refresh = new Map<string, string>();
  return {
    saveAccessToken: vi.fn<TokenStore['saveAccessToken']>().mockImplementation((id, record) => {
      access.set(id, record);
    }),
    getAccessToken: vi
      .fn<TokenStore['getAccessToken']>()
      .mockImplementation((id) => access.get(id) ?? null),
    saveRefreshToken: vi
      .fn<TokenStore['saveRefreshToken']>()
      .mockImplementation((id, token, persist) => {
        if (persist) refresh.set(id, token);
        else refresh.delete(id);
      }),
    getRefreshToken: vi
      .fn<TokenStore['getRefreshToken']>()
      .mockImplementation((id) => refresh.get(id) ?? null),
    clear: vi.fn<TokenStore['clear']>().mockImplementation((id) => {
      access.delete(id);
      refresh.delete(id);
    }),
    _seedAccess: (id, record) => access.set(id, record),
    _seedRefresh: (id, token) => refresh.set(id, token),
  };
}

// ---------------------------------------------------------------------------
// window.location override — jsdom's real Location throws "not implemented" on `.assign()`
// navigation and disallows redefining it via `vi.spyOn`; a full property replacement (verified
// working in this environment) is the supported way to intercept it without a real page load.
// ---------------------------------------------------------------------------

let originalLocation: Location;

function setLocation(overrides: { search?: string; assign?: ReturnType<typeof vi.fn> } = {}): void {
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

beforeEach(() => {
  originalLocation = window.location;
  window.sessionStorage.clear();
  window.localStorage.clear();
  setLocation();
  useSmartConnectionStore.setState({ connections: [], callbackError: null, requestedSyncId: null });
  useStore.getState().resetRecord();
});

afterEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: originalLocation,
  });
});

/** Drive the real `beginConnect` (with the given fakes injected) and capture the `state` query
 * param from the authorize URL it would have navigated to — this is how a genuine pending
 * handshake gets established in `sessionStorage`, without hardcoding the store's private
 * `sessionStorage` key. */
async function beginAndCaptureState(
  gateway: SmartFhirGateway,
  tokenStore: TokenStore,
  opts?: { stayConnected?: boolean; redirectUri?: string },
): Promise<string> {
  const assign = vi.fn();
  setLocation({ assign });
  useSmartConnectionStore.getState().configure({ gateway, tokenStore });
  await useSmartConnectionStore
    .getState()
    .beginConnect('https://ehr.example.org/fhir', 'stemma-app', opts);
  expect(assign).toHaveBeenCalledTimes(1);
  const url = new URL(assign.mock.calls[0][0] as string);
  const state = url.searchParams.get('state');
  expect(state).toBeTruthy();
  return state!;
}

function withCallbackQuery(code: string, state: string): void {
  setLocation({ search: `?code=${code}&state=${state}` });
}

// ---------------------------------------------------------------------------
// completeCallbackIfPresent — CSRF state verification
// ---------------------------------------------------------------------------

describe('completeCallbackIfPresent — CSRF state verification', () => {
  it('a state mismatch NEVER calls exchangeCode, sets callbackError, and clears the pending handshake', async () => {
    const gateway = fakeGateway();
    const tokenStore = fakeTokenStore();
    const realState = await beginAndCaptureState(gateway, tokenStore);

    withCallbackQuery('AUTH-CODE-1', 'this-state-does-not-match-anything');
    // A CSRF rejection surfaces as a rejected promise (the same catch/finally plumbing as any
    // other callback failure) — never a silently-resolved null.
    await expect(useSmartConnectionStore.getState().completeCallbackIfPresent()).rejects.toThrow(
      /state mismatch/i,
    );

    expect(gateway.exchangeCode).not.toHaveBeenCalled();
    expect(useSmartConnectionStore.getState().callbackError).toMatch(/state mismatch/i);

    // Pending was cleared as part of this failed attempt: a SECOND call, even presenting the
    // ORIGINALLY-correct state, now finds nothing pending and must still no-op. (If pending had
    // NOT been cleared, this would incorrectly succeed and call exchangeCode.)
    withCallbackQuery('AUTH-CODE-2', realState);
    const second = await useSmartConnectionStore.getState().completeCallbackIfPresent();
    expect(second).toBeNull();
    expect(gateway.exchangeCode).not.toHaveBeenCalled();
  });

  it('a matching state exchanges the code, persists tokens, scrubs the URL, and clears callbackError', async () => {
    const gateway = fakeGateway();
    const tokenStore = fakeTokenStore();
    const state = await beginAndCaptureState(gateway, tokenStore);
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState');

    withCallbackQuery('AUTH-CODE-OK', state);
    const connectionId = await useSmartConnectionStore.getState().completeCallbackIfPresent();

    expect(connectionId).toEqual(expect.any(String));
    expect(gateway.exchangeCode).toHaveBeenCalledTimes(1);
    const [, exchangeArgs] = gateway.exchangeCode.mock.calls[0] as [
      SmartEndpoints,
      { code: string; redirectUri: string; codeVerifier: string; clientId: string },
    ];
    expect(exchangeArgs.code).toBe('AUTH-CODE-OK');
    expect(exchangeArgs.clientId).toBe('stemma-app');
    expect(typeof exchangeArgs.codeVerifier).toBe('string');
    expect(exchangeArgs.codeVerifier.length).toBeGreaterThan(0);

    expect(tokenStore.saveAccessToken).toHaveBeenCalledWith(
      connectionId,
      expect.objectContaining({ accessToken: 'AT-exchanged' }),
    );
    expect(replaceStateSpy).toHaveBeenCalled();
    expect(useSmartConnectionStore.getState().callbackError).toBeNull();
    expect(useSmartConnectionStore.getState().connections.map((c) => c.id)).toContain(connectionId);
    // DR-0016: fixes the "redirected home, nothing happened" bug — a successful callback
    // now sets `requestedSyncId` to the new connection's id in the SAME `set` that adds the
    // connection, so the UI has something to react to (App navigates, PedigreeView opens
    // the panel, SmartFhirConnect auto-syncs) exactly the way a failed callback's
    // `callbackError` already worked.
    expect(useSmartConnectionStore.getState().requestedSyncId).toBe(connectionId);

    replaceStateSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// completeCallbackIfPresent — reconnect-in-place (DR-0033)
// ---------------------------------------------------------------------------

describe('completeCallbackIfPresent — reconnect-in-place (DR-0033)', () => {
  it('a callback for an ALREADY-CONNECTED fhirBaseUrl updates that connection in place: same id, tokens persisted under it, requestedSyncId resolves to it, and scopes/patientId refresh', async () => {
    const gateway = fakeGateway();
    const tokenStore = fakeTokenStore();
    useSmartConnectionStore.getState().configure({ gateway, tokenStore });
    // Pre-existing connection for the SAME fhirBaseUrl `beginAndCaptureState` always targets
    // ('https://ehr.example.org/fhir') — a stale/expired card the reconnect must update, not
    // duplicate.
    const existing = seedConnection({
      id: 'conn-existing',
      patientId: 'pat-old',
      scopesGranted: ['patient/Condition.read'],
      lastSyncAt: '2026-01-15T00:00:00.000Z',
      createdAt: '2025-06-01T00:00:00.000Z',
    });

    const state = await beginAndCaptureState(gateway, tokenStore, { stayConnected: true });
    withCallbackQuery('AUTH-CODE-RECONNECT', state);
    const resolvedId = await useSmartConnectionStore.getState().completeCallbackIfPresent();

    // Same id reused — no duplicate card.
    expect(resolvedId).toBe(existing.id);
    const connections = useSmartConnectionStore.getState().connections;
    expect(connections).toHaveLength(1);
    const updated = connections[0];
    expect(updated.id).toBe(existing.id);
    expect(updated.createdAt).toBe(existing.createdAt); // createdAt is preserved
    expect(updated.lastSyncAt).toBe(existing.lastSyncAt); // reconnect doesn't reset last-synced
    // Refreshed from the new OAuth response/pending handshake.
    expect(updated.patientId).toBe('pat-1'); // fakeGateway's exchangeCode resolves patient: 'pat-1'
    expect(updated.stayConnected).toBe(true);
    expect(updated.scopesGranted).toEqual(expect.arrayContaining(['openid', 'fhirUser']));

    // Tokens persisted under the SAME (reused) id, not a freshly-minted one.
    expect(tokenStore.saveAccessToken).toHaveBeenCalledWith(
      existing.id,
      expect.objectContaining({ accessToken: 'AT-exchanged' }),
    );

    // The post-callback auto-sync signal targets the EXISTING id.
    expect(useSmartConnectionStore.getState().requestedSyncId).toBe(existing.id);
  });

  it('a callback for a NEW fhirBaseUrl still appends rather than colliding with an unrelated existing connection', async () => {
    const gateway = fakeGateway();
    const tokenStore = fakeTokenStore();
    useSmartConnectionStore.getState().configure({ gateway, tokenStore });
    // An existing connection for a DIFFERENT portal — must be left untouched.
    const other = seedConnection({
      id: 'conn-other',
      fhirBaseUrl: 'https://other-ehr.example.org/fhir',
    });

    const state = await beginAndCaptureState(gateway, tokenStore);
    withCallbackQuery('AUTH-CODE-NEW', state);
    const newId = await useSmartConnectionStore.getState().completeCallbackIfPresent();

    expect(newId).toEqual(expect.any(String));
    expect(newId).not.toBe(other.id);
    const connections = useSmartConnectionStore.getState().connections;
    expect(connections).toHaveLength(2);
    expect(connections.map((c) => c.id)).toEqual(expect.arrayContaining([other.id, newId]));
    expect(useSmartConnectionStore.getState().requestedSyncId).toBe(newId);
  });
});

// ---------------------------------------------------------------------------
// requestSync / clearRequestedSync (DR-0016)
// ---------------------------------------------------------------------------

describe('requestSync / clearRequestedSync', () => {
  it('requestSync sets requestedSyncId and clearRequestedSync resets it to null', () => {
    expect(useSmartConnectionStore.getState().requestedSyncId).toBeNull();

    useSmartConnectionStore.getState().requestSync('conn-xyz');
    expect(useSmartConnectionStore.getState().requestedSyncId).toBe('conn-xyz');

    useSmartConnectionStore.getState().clearRequestedSync();
    expect(useSmartConnectionStore.getState().requestedSyncId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// completeCallbackIfPresent — idempotency / no double-exchange
// ---------------------------------------------------------------------------

describe('completeCallbackIfPresent — idempotency (the in-flight re-entrancy latch)', () => {
  it('two concurrent calls with the same pending code+state result in exactly ONE exchangeCode call', async () => {
    const gateway = fakeGateway();
    const tokenStore = fakeTokenStore();
    const state = await beginAndCaptureState(gateway, tokenStore);
    withCallbackQuery('AUTH-CODE-RACE', state);

    // Fire both synchronously (no await between them) so the second call's synchronous prefix
    // races the first's — this is what actually exercises the latch, not real timing.
    const store = useSmartConnectionStore.getState();
    const p1 = store.completeCallbackIfPresent();
    const p2 = store.completeCallbackIfPresent();
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(gateway.exchangeCode).toHaveBeenCalledTimes(1);
    // Exactly one of the two calls actually completed a handshake; the other silently no-op'd.
    expect([r1, r2].filter((r) => r !== null)).toHaveLength(1);
  });

  it('a subsequent call after the query/pending have been cleared is a pure no-op (no re-exchange)', async () => {
    const gateway = fakeGateway();
    const tokenStore = fakeTokenStore();
    const state = await beginAndCaptureState(gateway, tokenStore);
    withCallbackQuery('AUTH-CODE-ONCE', state);

    const first = await useSmartConnectionStore.getState().completeCallbackIfPresent();
    expect(first).toEqual(expect.any(String));
    expect(gateway.exchangeCode).toHaveBeenCalledTimes(1);

    // Same (now-stale) query string, called again — pending is gone, so this must no-op rather
    // than re-issuing the one-time authorization code a second time.
    const second = await useSmartConnectionStore.getState().completeCallbackIfPresent();
    expect(second).toBeNull();
    expect(gateway.exchangeCode).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// completeCallbackIfPresent — exchange failure
// ---------------------------------------------------------------------------

describe('completeCallbackIfPresent — on exchange failure', () => {
  it('still clears pending and scrubs the URL (finally), and sets callbackError', async () => {
    const gateway = fakeGateway({
      exchangeCode: vi.fn().mockRejectedValue(new Error('token endpoint rejected the code')),
    });
    const tokenStore = fakeTokenStore();
    const state = await beginAndCaptureState(gateway, tokenStore);
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState');

    withCallbackQuery('AUTH-CODE-FAIL', state);
    await expect(useSmartConnectionStore.getState().completeCallbackIfPresent()).rejects.toThrow(
      /token endpoint rejected/,
    );

    expect(useSmartConnectionStore.getState().callbackError).toMatch(/token endpoint rejected/);
    expect(replaceStateSpy).toHaveBeenCalled();
    expect(gateway.exchangeCode).toHaveBeenCalledTimes(1);

    // Pending was cleared despite the failure: replaying the SAME (still-valid) state again must
    // not re-attempt the exchange.
    withCallbackQuery('AUTH-CODE-RETRY', state);
    const retry = await useSmartConnectionStore.getState().completeCallbackIfPresent();
    expect(retry).toBeNull();
    expect(gateway.exchangeCode).toHaveBeenCalledTimes(1);

    replaceStateSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Token persistence policy
// ---------------------------------------------------------------------------

describe('token persistence policy', () => {
  it('stayConnected=false never persists a refresh token, even when the server hands one back', async () => {
    const gateway = fakeGateway({
      exchangeCode: vi.fn().mockResolvedValue({
        access_token: 'AT-1',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'RT-should-not-persist',
        patient: 'pat-1',
      } satisfies TokenResponse),
    });
    const tokenStore = fakeTokenStore();
    const state = await beginAndCaptureState(gateway, tokenStore, { stayConnected: false });
    withCallbackQuery('AUTH-CODE', state);

    const connectionId = await useSmartConnectionStore.getState().completeCallbackIfPresent();

    // The setter DOES get called (a refresh_token was present) but with persist=false — a wrong
    // implementation that ignores stayConnected and persists anyway must fail this.
    expect(tokenStore.saveRefreshToken).toHaveBeenCalledWith(
      connectionId,
      'RT-should-not-persist',
      false,
    );
    const connection = useSmartConnectionStore
      .getState()
      .connections.find((c) => c.id === connectionId);
    expect(connection?.stayConnected).toBe(false);
  });

  it('stayConnected=true persists the refresh token', async () => {
    const gateway = fakeGateway({
      exchangeCode: vi.fn().mockResolvedValue({
        access_token: 'AT-1',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'RT-should-persist',
        patient: 'pat-1',
      } satisfies TokenResponse),
    });
    const tokenStore = fakeTokenStore();
    const state = await beginAndCaptureState(gateway, tokenStore, { stayConnected: true });
    withCallbackQuery('AUTH-CODE', state);

    const connectionId = await useSmartConnectionStore.getState().completeCallbackIfPresent();

    expect(tokenStore.saveRefreshToken).toHaveBeenCalledWith(
      connectionId,
      'RT-should-persist',
      true,
    );
  });

  it('disconnect calls tokenStore.clear and removes the connection', () => {
    const tokenStore = fakeTokenStore();
    useSmartConnectionStore.getState().configure({ gateway: fakeGateway(), tokenStore });
    const conn = seedConnection();

    useSmartConnectionStore.getState().disconnect(conn.id);

    expect(tokenStore.clear).toHaveBeenCalledWith(conn.id);
    expect(useSmartConnectionStore.getState().connections).toEqual([]);
  });

  it('setStayConnected(id, false) drops any stored refresh token', () => {
    const tokenStore = fakeTokenStore();
    useSmartConnectionStore.getState().configure({ gateway: fakeGateway(), tokenStore });
    const conn = seedConnection({ stayConnected: true });
    tokenStore._seedRefresh(conn.id, 'RT-existing');

    useSmartConnectionStore.getState().setStayConnected(conn.id, false);

    expect(tokenStore.saveRefreshToken).toHaveBeenCalledWith(conn.id, '', false);
    expect(
      useSmartConnectionStore.getState().connections.find((c) => c.id === conn.id)?.stayConnected,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// syncNow
// ---------------------------------------------------------------------------

describe('syncNow', () => {
  it('returns the raw FhirImportBundle from the injected gateway, stamps lastSyncAt, and never writes the record store', async () => {
    const bundle: FhirImportBundle = {
      resourceType: 'Bundle',
      entry: [{ resource: { resourceType: 'Condition', id: 'c1' } }],
    };
    const gateway = fakeGateway({ fetchPatientData: vi.fn().mockResolvedValue(bundle) });
    const tokenStore = fakeTokenStore();
    useSmartConnectionStore.getState().configure({ gateway, tokenStore });
    const conn = seedConnection();
    tokenStore._seedAccess(conn.id, {
      accessToken: 'AT-valid',
      tokenType: 'Bearer',
      expiresAtMs: Date.now() + 100_000, // well within its validity window
    });

    const recordBefore = useStore.getState().record;
    const result = await useSmartConnectionStore.getState().syncNow(conn.id);

    expect(result).toEqual(bundle);
    expect(gateway.fetchPatientData).toHaveBeenCalledWith(
      conn.fhirBaseUrl,
      conn.patientId,
      'AT-valid',
    );
    const updated = useSmartConnectionStore.getState().connections.find((c) => c.id === conn.id);
    expect(updated?.lastSyncAt).toEqual(expect.any(String));
    expect(Number.isNaN(Date.parse(updated!.lastSyncAt!))).toBe(false);
    // The record store is untouched — syncNow only returns the raw bundle for review.
    expect(useStore.getState().record).toEqual(recordBefore);
  });

  it('refreshes the access token when the stored one is expired, then uses the fresh token to fetch', async () => {
    const gateway = fakeGateway();
    const tokenStore = fakeTokenStore();
    useSmartConnectionStore.getState().configure({ gateway, tokenStore });
    const conn = seedConnection();
    tokenStore._seedAccess(conn.id, {
      accessToken: 'AT-stale',
      tokenType: 'Bearer',
      expiresAtMs: Date.now() - 100_000, // already expired
    });
    tokenStore._seedRefresh(conn.id, 'RT-valid');

    await useSmartConnectionStore.getState().syncNow(conn.id);

    expect(gateway.refresh).toHaveBeenCalledTimes(1);
    expect(gateway.fetchPatientData).toHaveBeenCalledWith(
      conn.fhirBaseUrl,
      conn.patientId,
      'AT-refreshed', // the fakeGateway's refresh() resolved access_token, not the stale one
    );
  });

  it('does NOT refresh when the stored access token is still valid (never refreshes needlessly)', async () => {
    const gateway = fakeGateway();
    const tokenStore = fakeTokenStore();
    useSmartConnectionStore.getState().configure({ gateway, tokenStore });
    const conn = seedConnection();
    tokenStore._seedAccess(conn.id, {
      accessToken: 'AT-still-valid',
      tokenType: 'Bearer',
      expiresAtMs: Date.now() + 100_000,
    });
    tokenStore._seedRefresh(conn.id, 'RT-valid');

    await useSmartConnectionStore.getState().syncNow(conn.id);

    expect(gateway.refresh).not.toHaveBeenCalled();
    expect(gateway.fetchPatientData).toHaveBeenCalledWith(
      conn.fhirBaseUrl,
      conn.patientId,
      'AT-still-valid',
    );
  });
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function seedConnection(overrides: Partial<SmartConnection> = {}): SmartConnection {
  const conn: SmartConnection = {
    id: 'conn-1',
    fhirBaseUrl: 'https://ehr.example.org/fhir',
    authorizeEndpoint: ENDPOINTS.authorizeEndpoint,
    tokenEndpoint: ENDPOINTS.tokenEndpoint,
    clientId: 'stemma-app',
    patientId: 'pat-1',
    scopesGranted: ['patient/Condition.read'],
    offlineAccessGranted: false,
    stayConnected: false,
    lastSyncAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
  useSmartConnectionStore.setState({ connections: [conn] });
  return conn;
}
