/**
 * UI-only build-time configuration seam (DR-0016). This is the ONLY place anywhere in the
 * app that reads `import.meta.env` for the SMART-on-FHIR client id — `import.meta.env` is a
 * Vite/build concern (see CLAUDE.md's layering table: UI may read it, `src/store/` and
 * `src/integrations/` never may) and it stops here rather than leaking into
 * `useSmartConnectionStore` or the gateway.
 */

/**
 * The SMART-on-FHIR OAuth client id baked in at build time (`VITE_SMART_CLIENT_ID`), or
 * `null` when unset.
 *
 * A browser SPA is an OAuth **public client** (RFC 6749 §2.1): `client_id` is not a secret —
 * security rests on PKCE (already implemented in `integrations/smart-fhir/gateway.ts`) plus
 * the registered redirect URI — so baking a single id into the deployed build is standard,
 * and it is sourced in `.github/workflows/deploy.yml` from a GitHub Actions repository
 * **Variable** (`vars.SMART_CLIENT_ID`), not a Secret.
 *
 * When this returns `null` (a fork, or any build without the variable set), `SmartFhirConnect`
 * falls back to its manual "Client ID" field unchanged — the fork/local-dev path is preserved.
 */
export function buildTimeSmartClientId(): string | null {
  const v = import.meta.env.VITE_SMART_CLIENT_ID?.trim();
  return v ? v : null;
}
