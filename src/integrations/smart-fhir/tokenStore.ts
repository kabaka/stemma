/**
 * Where SMART-on-FHIR tokens live in the browser — a port with a `Web Storage` implementation.
 *
 * Token-handling policy (guardrail #5, local-first & private by default; DR-0020):
 * - The **access token** is a short-lived bearer secret; it is kept in `sessionStorage`, so it is
 *   scoped to the tab/session and evaporates when the browser session ends — never persisted to
 *   disk across sessions.
 * - The **refresh token** is a long-lived credential and is written to `localStorage` **only** when
 *   the user has explicitly opted into "stay connected"; otherwise it is never persisted at all.
 * - {@link TokenStore.clear} wipes both stores for a connection (the sign-out / disconnect path).
 * - All keys are namespaced `stemma-smart-*` so they never collide with the record/history stores.
 *
 * Layering: `src/integrations/smart-fhir/` — imports only `@/domain` types (none needed here) and
 * the ambient Web Storage globals; never `store`, `ui`, `import`, or `export`. No raw token ever
 * transits the UI: it flows UI → store → this port only.
 */

/** The access-token half of a connection's credentials (a per-session secret). */
export interface AccessTokenRecord {
  accessToken: string;
  tokenType: string;
  /** Absolute expiry, epoch ms (from {@link file://./expiry.ts}`computeExpiresAtMs`). */
  expiresAtMs: number;
  scope?: string;
  patientId?: string;
}

export interface TokenStore {
  /** Persist the (session-scoped) access token for a connection. */
  saveAccessToken(connectionId: string, record: AccessTokenRecord): void;
  /** Load the access token for a connection, or `null` when absent/corrupt. */
  getAccessToken(connectionId: string): AccessTokenRecord | null;
  /** Persist the refresh token — ONLY honoured when `stayConnected` is true; false is a no-op
   * and additionally clears any previously stored refresh token. */
  saveRefreshToken(connectionId: string, refreshToken: string, stayConnected: boolean): void;
  /** Load the refresh token for a connection, or `null`. */
  getRefreshToken(connectionId: string): string | null;
  /** Wipe both the access token (session) and refresh token (local) for a connection. */
  clear(connectionId: string): void;
}

const ACCESS_PREFIX = 'stemma-smart-access-';
const REFRESH_PREFIX = 'stemma-smart-refresh-';

const accessKey = (id: string): string => `${ACCESS_PREFIX}${id}`;
const refreshKey = (id: string): string => `${REFRESH_PREFIX}${id}`;

/**
 * The browser {@link TokenStore}: access tokens in `sessionStorage`, refresh tokens in
 * `localStorage` (only under "stay connected"). Every access is defensively guarded so a
 * disabled/unavailable Web Storage (private mode, SSR) degrades to a no-op / `null` rather than
 * throwing.
 */
export class BrowserTokenStore implements TokenStore {
  private readonly session: Storage | undefined;
  private readonly local: Storage | undefined;

  constructor(
    session: Storage | undefined = safeStorage('session'),
    local: Storage | undefined = safeStorage('local'),
  ) {
    this.session = session;
    this.local = local;
  }

  saveAccessToken(connectionId: string, record: AccessTokenRecord): void {
    try {
      this.session?.setItem(accessKey(connectionId), JSON.stringify(record));
    } catch {
      // Storage unavailable/quota — a lost access token just forces a re-auth, never a crash.
    }
  }

  getAccessToken(connectionId: string): AccessTokenRecord | null {
    try {
      const raw = this.session?.getItem(accessKey(connectionId));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as AccessTokenRecord;
      return typeof parsed?.accessToken === 'string' ? parsed : null;
    } catch {
      return null;
    }
  }

  saveRefreshToken(connectionId: string, refreshToken: string, stayConnected: boolean): void {
    try {
      if (stayConnected) {
        this.local?.setItem(refreshKey(connectionId), refreshToken);
      } else {
        // Not opted in — never persist, and drop any stale token from a prior opt-in.
        this.local?.removeItem(refreshKey(connectionId));
      }
    } catch {
      // Storage unavailable — silently skip persistence.
    }
  }

  getRefreshToken(connectionId: string): string | null {
    try {
      return this.local?.getItem(refreshKey(connectionId)) ?? null;
    } catch {
      return null;
    }
  }

  clear(connectionId: string): void {
    try {
      this.session?.removeItem(accessKey(connectionId));
    } catch {
      /* ignore */
    }
    try {
      this.local?.removeItem(refreshKey(connectionId));
    } catch {
      /* ignore */
    }
  }
}

/** Resolve a Web Storage area, or `undefined` when it is unavailable (SSR / private mode). */
function safeStorage(kind: 'session' | 'local'): Storage | undefined {
  try {
    const storage = kind === 'session' ? globalThis.sessionStorage : globalThis.localStorage;
    return storage ?? undefined;
  } catch {
    return undefined;
  }
}

/** The token store the app uses by default. */
export const defaultTokenStore: TokenStore = new BrowserTokenStore();
