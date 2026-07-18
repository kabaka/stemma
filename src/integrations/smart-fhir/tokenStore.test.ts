/**
 * Oracle for `src/integrations/smart-fhir/tokenStore.ts` (`BrowserTokenStore`) — the ONLY place a
 * SMART-on-FHIR token is allowed to live. The policy under test (guardrail #5, local-first &
 * private by default; DR-0020): the access token is session-scoped only (`sessionStorage`); the
 * refresh token is a long-lived credential written to `localStorage` **only** when the caller
 * explicitly opts in (`persist`/`stayConnected: true`) — never persisted otherwise, and any stale
 * persisted refresh token is dropped the moment that opt-in is withdrawn. jsdom provides real
 * `sessionStorage`/`localStorage` (Web Storage, not the network/clock/entropy determinism carve-out
 * applies here — these are injected concrete `Storage` instances, not global ambient state read
 * implicitly), so this suite exercises the real storage APIs rather than fakes.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { BrowserTokenStore, defaultTokenStore } from './tokenStore';
import type { AccessTokenRecord } from './tokenStore';

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
});

const record: AccessTokenRecord = {
  accessToken: 'AT-abc123',
  tokenType: 'Bearer',
  expiresAtMs: 1_700_000_000_000,
  scope: 'patient/Condition.read',
  patientId: 'pat-1',
};

function makeStore(): BrowserTokenStore {
  return new BrowserTokenStore(window.sessionStorage, window.localStorage);
}

function storageKeys(storage: Storage): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k) keys.push(k);
  }
  return keys;
}

describe('BrowserTokenStore — access token lives ONLY in sessionStorage', () => {
  it('saves and reads back the access token via sessionStorage, namespaced stemma-smart-access-*', () => {
    const store = makeStore();
    store.saveAccessToken('conn-1', record);
    expect(window.sessionStorage.getItem('stemma-smart-access-conn-1')).toBe(
      JSON.stringify(record),
    );
    expect(store.getAccessToken('conn-1')).toEqual(record);
  });

  it('never writes the access token to localStorage', () => {
    const store = makeStore();
    store.saveAccessToken('conn-1', record);
    expect(window.localStorage.getItem('stemma-smart-access-conn-1')).toBeNull();
    expect(window.localStorage.length).toBe(0);
  });

  it('returns null for an unknown connection id, never throwing', () => {
    const store = makeStore();
    expect(store.getAccessToken('nope')).toBeNull();
  });

  it('returns null (never throws) for corrupt JSON already sitting in sessionStorage', () => {
    window.sessionStorage.setItem('stemma-smart-access-conn-1', '{not json');
    const store = makeStore();
    expect(() => store.getAccessToken('conn-1')).not.toThrow();
    expect(store.getAccessToken('conn-1')).toBeNull();
  });
});

describe('BrowserTokenStore — refresh token lives in localStorage ONLY when persist is true', () => {
  it('persists the refresh token to localStorage when persist=true', () => {
    const store = makeStore();
    store.saveRefreshToken('conn-1', 'RT-xyz', true);
    expect(window.localStorage.getItem('stemma-smart-refresh-conn-1')).toBe('RT-xyz');
    expect(store.getRefreshToken('conn-1')).toBe('RT-xyz');
  });

  it('never writes the refresh token to sessionStorage', () => {
    const store = makeStore();
    store.saveRefreshToken('conn-1', 'RT-xyz', true);
    expect(window.sessionStorage.getItem('stemma-smart-refresh-conn-1')).toBeNull();
  });

  it('does NOT persist the refresh token when persist=false, even though a token was given', () => {
    const store = makeStore();
    store.saveRefreshToken('conn-1', 'RT-xyz', false);
    expect(window.localStorage.getItem('stemma-smart-refresh-conn-1')).toBeNull();
    expect(store.getRefreshToken('conn-1')).toBeNull();
  });

  it('saveRefreshToken(id, token, false) removes a previously-persisted (stale) refresh token', () => {
    const store = makeStore();
    store.saveRefreshToken('conn-1', 'RT-old', true);
    expect(window.localStorage.getItem('stemma-smart-refresh-conn-1')).toBe('RT-old');

    store.saveRefreshToken('conn-1', 'RT-old', false);
    expect(window.localStorage.getItem('stemma-smart-refresh-conn-1')).toBeNull();
    expect(store.getRefreshToken('conn-1')).toBeNull();
  });

  it('returns null for an unknown connection id, never throwing', () => {
    const store = makeStore();
    expect(store.getRefreshToken('nope')).toBeNull();
  });
});

describe('BrowserTokenStore.clear', () => {
  it('wipes both the access token (session) and the refresh token (local) for a connection', () => {
    const store = makeStore();
    store.saveAccessToken('conn-1', record);
    store.saveRefreshToken('conn-1', 'RT-xyz', true);

    store.clear('conn-1');

    expect(store.getAccessToken('conn-1')).toBeNull();
    expect(store.getRefreshToken('conn-1')).toBeNull();
    expect(window.sessionStorage.getItem('stemma-smart-access-conn-1')).toBeNull();
    expect(window.localStorage.getItem('stemma-smart-refresh-conn-1')).toBeNull();
  });

  it("never touches a DIFFERENT connection's tokens", () => {
    const store = makeStore();
    store.saveAccessToken('conn-1', record);
    store.saveRefreshToken('conn-1', 'RT-1', true);
    store.saveAccessToken('conn-2', record);
    store.saveRefreshToken('conn-2', 'RT-2', true);

    store.clear('conn-1');

    expect(store.getAccessToken('conn-2')).toEqual(record);
    expect(store.getRefreshToken('conn-2')).toBe('RT-2');
  });

  it('is a no-op (never throws) for a connection with no stored tokens at all', () => {
    const store = makeStore();
    expect(() => store.clear('never-existed')).not.toThrow();
  });
});

describe('BrowserTokenStore — key namespacing (stemma-smart-*)', () => {
  it('never writes a key outside the stemma-smart- namespace, in either storage', () => {
    const store = makeStore();
    store.saveAccessToken('conn-1', record);
    store.saveRefreshToken('conn-1', 'RT-xyz', true);

    for (const key of [
      ...storageKeys(window.sessionStorage),
      ...storageKeys(window.localStorage),
    ]) {
      expect(key.startsWith('stemma-smart-')).toBe(true);
    }
  });

  it('uses distinct access/refresh key prefixes so the two never collide for the same connection id', () => {
    const store = makeStore();
    store.saveAccessToken('shared-id', record);
    store.saveRefreshToken('shared-id', 'RT-shared', true);

    expect(window.sessionStorage.getItem('stemma-smart-access-shared-id')).not.toBeNull();
    expect(window.localStorage.getItem('stemma-smart-refresh-shared-id')).not.toBeNull();
    // Reading the "wrong" store for that suffix must not accidentally resolve the other secret.
    expect(window.localStorage.getItem('stemma-smart-access-shared-id')).toBeNull();
    expect(window.sessionStorage.getItem('stemma-smart-refresh-shared-id')).toBeNull();
  });
});

describe('defaultTokenStore', () => {
  it('is a BrowserTokenStore wired to the real browser storage (the port the app actually uses)', () => {
    expect(defaultTokenStore).toBeInstanceOf(BrowserTokenStore);
  });
});
