/**
 * Oracle for `src/integrations/smart-fhir/expiry.ts` — pure token-expiry math over an injected
 * `nowMs`, never the wall clock. `isAccessTokenExpired` intentionally treats a token as expired
 * a little *before* its literal expiry (`skewMs`, default 30s) so a sync doesn't race a
 * still-in-flight request against token rotation — that safety margin is the behavior under
 * test, not just the arithmetic.
 */
import { describe, expect, it } from 'vitest';
import { computeExpiresAtMs, isAccessTokenExpired } from './expiry';

describe('computeExpiresAtMs', () => {
  it('adds expires_in seconds (converted to ms) to the given nowMs', () => {
    expect(computeExpiresAtMs(3600, 1_000)).toBe(1_000 + 3_600_000);
  });

  it('returns nowMs unchanged for an expires_in of 0', () => {
    expect(computeExpiresAtMs(0, 1_000)).toBe(1_000);
  });

  it('handles a fractional-second expires_in without losing precision to whole seconds', () => {
    expect(computeExpiresAtMs(1.5, 0)).toBe(1500);
  });
});

describe('isAccessTokenExpired', () => {
  const expiresAtMs = 1_000_000;

  it('is not expired well before the default 30s skew window', () => {
    expect(isAccessTokenExpired(expiresAtMs, 900_000)).toBe(false);
  });

  it('treats the default 30s-before-expiry instant as already expired (inclusive boundary)', () => {
    expect(isAccessTokenExpired(expiresAtMs, 970_000)).toBe(true); // exactly expiresAt - 30_000
  });

  it('is not yet expired 1ms before the default skew boundary', () => {
    expect(isAccessTokenExpired(expiresAtMs, 969_999)).toBe(false);
  });

  it('is expired at the literal expiry instant', () => {
    expect(isAccessTokenExpired(expiresAtMs, expiresAtMs)).toBe(true);
  });

  it('is expired well past expiry', () => {
    expect(isAccessTokenExpired(expiresAtMs, 1_500_000)).toBe(true);
  });

  it('honours an explicit skewMs override of 0 (no early safety margin)', () => {
    expect(isAccessTokenExpired(expiresAtMs, 999_999, 0)).toBe(false);
    expect(isAccessTokenExpired(expiresAtMs, 1_000_000, 0)).toBe(true);
  });

  it('honours a larger explicit skewMs', () => {
    expect(isAccessTokenExpired(expiresAtMs, 900_000, 120_000)).toBe(true); // 1_000_000-120_000=880_000 <= 900_000
    expect(isAccessTokenExpired(expiresAtMs, 800_000, 120_000)).toBe(false);
  });
});
