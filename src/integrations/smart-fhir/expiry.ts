/**
 * Pure token-expiry math. Time is always an **injected** `nowMs` (never the wall clock), so the
 * whole module is deterministic. {@link isAccessTokenExpired} deliberately reports a token as
 * expired a little *before* its literal expiry (`skewMs`, default 30 s) so a sync never races a
 * still-in-flight request against server-side token rotation — a safety margin, not just arithmetic.
 *
 * Layering: `src/integrations/smart-fhir/` — imports nothing; no network, no clock, no storage.
 */

/** The absolute expiry instant (epoch ms) for a token minted at `nowMs` that lives `expiresInSec`. */
export function computeExpiresAtMs(expiresInSec: number, nowMs: number): number {
  return nowMs + expiresInSec * 1000;
}

/** Default early-expiry safety margin: treat a token as expired 30 s before its literal expiry. */
const DEFAULT_SKEW_MS = 30_000;

/**
 * Whether the access token minted with absolute expiry `expiresAtMs` should be considered expired
 * as of `nowMs`, applying an early-expiry `skewMs` (default 30 s). The boundary is inclusive: at
 * exactly `expiresAtMs - skewMs` the token is already expired.
 */
export function isAccessTokenExpired(
  expiresAtMs: number,
  nowMs: number,
  skewMs: number = DEFAULT_SKEW_MS,
): boolean {
  return nowMs >= expiresAtMs - skewMs;
}
