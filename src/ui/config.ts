/**
 * UI-only build-time configuration seam (DR-0016, extended for multi-vendor in DR-0016's
 * Cerner/Oracle Health follow-up). This is the ONLY place anywhere in the app that reads
 * `import.meta.env` for a SMART-on-FHIR client id — `import.meta.env` is a Vite/build concern
 * (see CLAUDE.md's layering table: UI may read it, `src/store/` and `src/integrations/` never
 * may) and it stops here rather than leaking into `useSmartConnectionStore` or the gateway.
 */
import type { SmartVendor } from '@/data/smart-endpoints';

/**
 * The SMART-on-FHIR OAuth client id baked in at build time for the given vendor, or `null`
 * when unset.
 *
 * Epic and Cerner/Oracle Health are each a separate app registration — one client id per
 * vendor, shared across every org that vendor hosts (a single Epic id covers every Epic
 * organization; a single Cerner id covers every Cerner/Oracle Health tenant) — so the id must
 * be resolved per vendor, keyed off the provider the user picked (or, for a manually-typed
 * URL, the host it's inferred from).
 *
 * A browser SPA is an OAuth **public client** (RFC 6749 §2.1) for both vendors: `client_id`
 * is not a secret — security rests on PKCE (already implemented in
 * `integrations/smart-fhir/gateway.ts`) plus the registered redirect URI — so baking each id
 * into the deployed build is standard, and both are sourced in `.github/workflows/deploy.yml`
 * from GitHub Actions repository **Variables** (`vars.EPIC_CLIENT_ID` / `vars.CERNER_CLIENT_ID`),
 * not Secrets. `VITE_SMART_CLIENT_ID` is kept as a back-compat alias for Epic's id — the name
 * predates the Cerner build-out and pre-existing deploys/forks that only set it must keep
 * working.
 *
 * When this returns `null` (a fork, or any build without the relevant variable set for the
 * active vendor), `SmartFhirConnect` falls back to its manual "Client ID" field unchanged —
 * the fork/local-dev path is preserved.
 *
 * GitHub Actions evaluates an unset repository Variable to the EMPTY STRING, not `undefined`
 * — `deploy.yml` sets `VITE_EPIC_CLIENT_ID: ${{ vars.EPIC_CLIENT_ID }}` unconditionally, so a
 * deploy that only ever configured the legacy `SMART_CLIENT_ID` Variable still bakes
 * `VITE_EPIC_CLIENT_ID=''` into the build. `??` does not fall through on `''`, so the
 * fallback chain below is walked value-by-value, treating an empty/whitespace-only value the
 * same as absent, rather than a single `??`/`||` expression.
 */
export function buildTimeClientId(vendor: SmartVendor): string | null {
  const firstNonEmpty = (...vals: (string | undefined)[]): string | null => {
    for (const val of vals) {
      const v = val?.trim();
      if (v) return v;
    }
    return null;
  };
  return vendor === 'cerner'
    ? firstNonEmpty(import.meta.env.VITE_CERNER_CLIENT_ID)
    : firstNonEmpty(import.meta.env.VITE_EPIC_CLIENT_ID, import.meta.env.VITE_SMART_CLIENT_ID);
}
