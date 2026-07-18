/**
 * SMART-on-FHIR connection store — the ONLY code path that drives the OAuth gateway + token store,
 * and the bridge between the impure integration port and the pure FHIR parser.
 *
 * A SEPARATE Zustand `persist` store from the record store, under its own `stemma-smart`
 * localStorage key (failure-isolation, like `useHistoryStore`). It persists ONLY non-secret
 * connection metadata ({@link SmartConnection}) — never a token. Access/refresh tokens live
 * exclusively in the {@link TokenStore} (session/local storage, per its policy); the transient
 * PKCE handshake state lives in `sessionStorage` across the redirect and is wiped on completion.
 *
 * Clinical-safety / privacy (guardrail #5, local-first & private by default; DR-0020): the only
 * network egress is the user-initiated OAuth + FHIR reads against the EHR the user chose. No token
 * ever enters the persisted record or transits the UI. {@link syncNow} returns a parsed record for
 * the review surface but deliberately does NOT write it — the user reviews and applies it through
 * the existing import-review pipeline (`replaceRecord`), so nothing lands unreviewed.
 *
 * Layering: `src/store/` may import `domain`, `data`, `integrations`, and the pure `import` parser;
 * never `ui`. The gateway + token store are injectable (defaulting to the real ones) so tests can
 * drive the whole flow without a network.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  FetchSmartFhirGateway,
  buildAuthorizeUrl,
  computeCodeChallenge,
  computeExpiresAtMs,
  defaultTokenStore,
  generateCodeVerifier,
  generateState,
  isAccessTokenExpired,
} from '@/integrations/smart-fhir';
import type {
  SmartEndpoints,
  SmartFhirGateway,
  TokenResponse,
  TokenStore,
} from '@/integrations/smart-fhir';
import { parseFhirImport } from '@/import/fhir';
import type { ParsedHealthRecord } from '@/import/health-record';

/** Persisted, NON-secret connection metadata. Tokens never live here — they go through the
 * {@link TokenStore}. */
export interface SmartConnection {
  id: string;
  fhirBaseUrl: string;
  authorizeEndpoint: string;
  tokenEndpoint: string;
  clientId: string;
  patientId: string | null;
  scopesGranted: string[];
  offlineAccessGranted: boolean;
  stayConnected: boolean;
  lastSyncAt: string | null;
  createdAt: string;
}

/** Options for {@link SmartConnectionActions.beginConnect}. */
export interface BeginConnectOptions {
  /** Persist the refresh token so the connection survives a browser restart (requests
   * `offline_access`). Off by default (private-by-default). */
  stayConnected?: boolean;
  /** The redirect URI registered with the EHR; defaults to the current page URL. */
  redirectUri?: string;
}

/** The PKCE handshake state carried across the authorization redirect (sessionStorage only). */
interface PendingConnect {
  codeVerifier: string;
  state: string;
  fhirBaseUrl: string;
  endpoints: SmartEndpoints;
  clientId: string;
  redirectUri: string;
  scope: string;
  stayConnected: boolean;
}

const PERSIST_KEY = 'stemma-smart';
const PENDING_KEY = 'stemma-smart-pending';

/** The base scope set Stemma requests: patient context + read of the two axes it imports. */
const BASE_SCOPES = [
  'openid',
  'fhirUser',
  'launch/patient',
  'patient/Patient.read',
  'patient/Condition.read',
  'patient/FamilyMemberHistory.read',
];

/** Same id scheme as the other stores — `crypto.randomUUID` with a deterministic-ish fallback. */
const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `smart-${Math.floor(Math.random() * 1e9).toString(36)}`;

const nowIso = (): string => new Date().toISOString();

interface SmartConnectionState {
  connections: SmartConnection[];
  /** Injectable transport (default: the real fetch gateway). Not persisted. */
  gateway: SmartFhirGateway;
  /** Injectable token store (default: the real browser store). Not persisted. */
  tokenStore: TokenStore;
}

interface SmartConnectionActions {
  /** Override the injected gateway / token store (tests). */
  configure: (deps: { gateway?: SmartFhirGateway; tokenStore?: TokenStore }) => void;
  /** Discover the server, build the PKCE authorize URL, stash the handshake, and navigate. */
  beginConnect: (
    fhirBaseUrl: string,
    clientId: string,
    opts?: BeginConnectOptions,
  ) => Promise<void>;
  /** If the page URL carries an OAuth `code`+`state`, verify state, exchange the code, persist the
   * connection + tokens, strip the query, and return the new connection id (else `null`). */
  completeCallbackIfPresent: () => Promise<string | null>;
  /** Fetch + parse the patient's data into a {@link ParsedHealthRecord} for review. Does NOT write
   * the record — the caller applies the reviewed subset via the import-review pipeline. */
  syncNow: (connectionId: string) => Promise<ParsedHealthRecord>;
  /** Forget a connection and wipe its tokens. */
  disconnect: (connectionId: string) => void;
  /** Toggle "stay connected"; turning it off drops any persisted refresh token. */
  setStayConnected: (connectionId: string, stayConnected: boolean) => void;
}

export type SmartConnectionStore = SmartConnectionState & SmartConnectionActions;

// ---------------------------------------------------------------------------
// Hydration guards — fail closed to `[]` on anything malformed (parity with useHistoryStore).
// ---------------------------------------------------------------------------

function isConnection(v: unknown): v is SmartConnection {
  if (typeof v !== 'object' || v === null) return false;
  const c = v as Partial<SmartConnection>;
  return (
    typeof c.id === 'string' &&
    typeof c.fhirBaseUrl === 'string' &&
    typeof c.authorizeEndpoint === 'string' &&
    typeof c.tokenEndpoint === 'string' &&
    typeof c.clientId === 'string' &&
    Array.isArray(c.scopesGranted)
  );
}

function sanitizeConnections(input: unknown): SmartConnection[] {
  const raw = (input as { connections?: unknown } | null | undefined)?.connections ?? input;
  return Array.isArray(raw) ? raw.filter(isConnection) : [];
}

// ---------------------------------------------------------------------------
// sessionStorage helpers for the transient PKCE handshake.
// ---------------------------------------------------------------------------

function savePending(pending: PendingConnect): void {
  try {
    globalThis.sessionStorage?.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch {
    /* storage unavailable — the connect flow will surface a re-auth prompt */
  }
}

function loadPending(): PendingConnect | null {
  try {
    const raw = globalThis.sessionStorage?.getItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as PendingConnect) : null;
  } catch {
    return null;
  }
}

function clearPending(): void {
  try {
    globalThis.sessionStorage?.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useSmartConnectionStore = create<SmartConnectionStore>()(
  persist(
    (set, get) => {
      const scopesFrom = (response: TokenResponse, requested: string): string[] =>
        (response.scope ?? requested).split(/\s+/).filter(Boolean);

      const persistTokens = (
        connectionId: string,
        response: TokenResponse,
        stayConnected: boolean,
      ): void => {
        const { tokenStore } = get();
        tokenStore.saveAccessToken(connectionId, {
          accessToken: response.access_token,
          tokenType: response.token_type,
          expiresAtMs: computeExpiresAtMs(response.expires_in, Date.now()),
          scope: response.scope,
          patientId: response.patient,
        });
        if (response.refresh_token) {
          tokenStore.saveRefreshToken(connectionId, response.refresh_token, stayConnected);
        }
      };

      /** A currently-valid access token for a connection, refreshing if needed. */
      const validAccessToken = async (connection: SmartConnection): Promise<string> => {
        const { gateway, tokenStore } = get();
        const record = tokenStore.getAccessToken(connection.id);
        if (record && !isAccessTokenExpired(record.expiresAtMs, Date.now())) {
          return record.accessToken;
        }
        const refreshToken = tokenStore.getRefreshToken(connection.id);
        if (refreshToken) {
          const response = await gateway.refresh(
            {
              authorizeEndpoint: connection.authorizeEndpoint,
              tokenEndpoint: connection.tokenEndpoint,
            },
            { refreshToken, clientId: connection.clientId },
          );
          persistTokens(connection.id, response, connection.stayConnected);
          return response.access_token;
        }
        throw new Error('This connection has expired and needs to be reauthorized.');
      };

      return {
        connections: [],
        gateway: new FetchSmartFhirGateway(),
        tokenStore: defaultTokenStore,

        configure: (deps) =>
          set((s) => ({
            gateway: deps.gateway ?? s.gateway,
            tokenStore: deps.tokenStore ?? s.tokenStore,
          })),

        beginConnect: async (fhirBaseUrl, clientId, opts = {}) => {
          const { gateway } = get();
          const stayConnected = opts.stayConnected ?? false;
          const endpoints = await gateway.discover(fhirBaseUrl);

          const codeVerifier = generateCodeVerifier();
          const state = generateState();
          const codeChallenge = await computeCodeChallenge(codeVerifier);

          const scopeList = stayConnected ? [...BASE_SCOPES, 'offline_access'] : BASE_SCOPES;
          const scope = scopeList.join(' ');
          const redirectUri =
            opts.redirectUri ??
            (typeof globalThis.location !== 'undefined'
              ? `${globalThis.location.origin}${globalThis.location.pathname}`
              : '');

          savePending({
            codeVerifier,
            state,
            fhirBaseUrl,
            endpoints,
            clientId,
            redirectUri,
            scope,
            stayConnected,
          });

          const url = buildAuthorizeUrl({
            authorizeEndpoint: endpoints.authorizeEndpoint,
            clientId,
            redirectUri,
            scope,
            state,
            aud: fhirBaseUrl,
            codeChallenge,
          });
          globalThis.location?.assign(url);
        },

        completeCallbackIfPresent: async () => {
          if (typeof globalThis.location === 'undefined') return null;
          const params = new URLSearchParams(globalThis.location.search);
          const code = params.get('code');
          const state = params.get('state');
          if (!code || !state) return null;

          const pending = loadPending();
          if (!pending) return null;
          // CSRF: the returned state MUST match the one we generated for this handshake.
          if (state !== pending.state) {
            clearPending();
            throw new Error('SMART callback state mismatch — the sign-in was rejected for safety.');
          }

          const { gateway } = get();
          const response = await gateway.exchangeCode(pending.endpoints, {
            code,
            redirectUri: pending.redirectUri,
            codeVerifier: pending.codeVerifier,
            clientId: pending.clientId,
          });

          const id = newId();
          const scopesGranted = scopesFrom(response, pending.scope);
          const connection: SmartConnection = {
            id,
            fhirBaseUrl: pending.fhirBaseUrl,
            authorizeEndpoint: pending.endpoints.authorizeEndpoint,
            tokenEndpoint: pending.endpoints.tokenEndpoint,
            clientId: pending.clientId,
            patientId: response.patient ?? null,
            scopesGranted,
            offlineAccessGranted: scopesGranted.includes('offline_access'),
            stayConnected: pending.stayConnected,
            lastSyncAt: null,
            createdAt: nowIso(),
          };

          persistTokens(id, response, pending.stayConnected);
          set((s) => ({ connections: [...s.connections, connection] }));
          clearPending();

          // Strip the OAuth query params from the address bar (no code/state left behind).
          try {
            globalThis.history?.replaceState(
              null,
              '',
              `${globalThis.location.origin}${globalThis.location.pathname}`,
            );
          } catch {
            /* history API unavailable — non-fatal */
          }

          return id;
        },

        syncNow: async (connectionId) => {
          const connection = get().connections.find((c) => c.id === connectionId);
          if (!connection) {
            throw new Error('Unknown SMART connection.');
          }
          if (!connection.patientId) {
            throw new Error('This connection has no patient context to sync.');
          }
          const accessToken = await validAccessToken(connection);
          const bundle = await get().gateway.fetchPatientData(
            connection.fhirBaseUrl,
            connection.patientId,
            accessToken,
          );
          const parsed = parseFhirImport(bundle, { patientId: connection.patientId });

          set((s) => ({
            connections: s.connections.map((c) =>
              c.id === connectionId ? { ...c, lastSyncAt: nowIso() } : c,
            ),
          }));
          return parsed;
        },

        disconnect: (connectionId) => {
          get().tokenStore.clear(connectionId);
          set((s) => ({ connections: s.connections.filter((c) => c.id !== connectionId) }));
        },

        setStayConnected: (connectionId, stayConnected) => {
          if (!stayConnected) {
            // Drop any persisted refresh token immediately.
            get().tokenStore.saveRefreshToken(connectionId, '', false);
          }
          set((s) => ({
            connections: s.connections.map((c) =>
              c.id === connectionId ? { ...c, stayConnected } : c,
            ),
          }));
        },
      };
    },
    {
      name: PERSIST_KEY,
      version: 1,
      // Persist ONLY the non-secret connection list — never the injected deps, never a token.
      partialize: (s): { connections: SmartConnection[] } => ({ connections: s.connections }),
      migrate: (persisted): { connections: SmartConnection[] } => ({
        connections: sanitizeConnections(persisted),
      }),
      merge: (persisted, current): SmartConnectionStore => ({
        ...current,
        connections: sanitizeConnections(persisted),
      }),
    },
  ),
);
