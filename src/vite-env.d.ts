/// <reference types="vite/client" />

// Augments Vite's own `ImportMetaEnv` (declaration merging) with the one app-specific env
// var Stemma reads — see `src/ui/config.ts`, the only place it's consumed. Typed explicitly
// (not left to vite/client's `[key: string]: any` index signature) so a typo or a dropped
// `.trim()` guard is a compile error, not a silent `any`.
interface ImportMetaEnv {
  /** SMART-on-FHIR public OAuth client id baked in at build time (DR-0016), sourced from the
   *  GitHub Actions repository Variable `vars.SMART_CLIENT_ID` in `.github/workflows/deploy.yml`
   *  (a public client's id is not a secret — RFC 6749 §2.1). Unset on a fork/local build. */
  readonly VITE_SMART_CLIENT_ID?: string;
}
