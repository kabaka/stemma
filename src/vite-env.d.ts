/// <reference types="vite/client" />

// Augments Vite's own `ImportMetaEnv` (declaration merging) with the app-specific env vars
// Stemma reads — see `src/ui/config.ts`, the only place they're consumed. Typed explicitly
// (not left to vite/client's `[key: string]: any` index signature) so a typo or a dropped
// `.trim()` guard is a compile error, not a silent `any`.
interface ImportMetaEnv {
  /** Epic public OAuth client id baked in at build time (DR-0016), sourced from the GitHub
   *  Actions repository Variable `vars.EPIC_CLIENT_ID` in `.github/workflows/deploy.yml` (a
   *  public client's id is not a secret — RFC 6749 §2.1). Unset on a fork/local build. */
  readonly VITE_EPIC_CLIENT_ID?: string;
  /** Cerner/Oracle Health public OAuth client id baked in at build time, sourced from
   *  `vars.CERNER_CLIENT_ID`. Unset on a fork/local build. */
  readonly VITE_CERNER_CLIENT_ID?: string;
  /** Back-compat alias for `VITE_EPIC_CLIENT_ID` — the name predates multi-vendor support;
   *  pre-existing deploys/forks that only set this keep working (see `src/ui/config.ts`). */
  readonly VITE_SMART_CLIENT_ID?: string;
}
