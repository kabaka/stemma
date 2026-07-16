/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// The site is served from https://kabaka.github.io/stemma/ on GitHub Pages,
// so built asset URLs must be prefixed with the repo name. Local dev uses '/'.
const base = process.env.GITHUB_PAGES === 'true' ? '/stemma/' : '/';

// Content-Security-Policy — local-first hardening (docs/AUDIT.md, security lens).
// The app's only runtime network egress is the user-triggered NLM vocabulary lookup,
// so connect-src is restricted to self + that one host. script-src is 'self' only
// (no inline, no eval — verified against the built bundle). style-src keeps
// 'unsafe-inline' because the exported pedigree SVG carries an inline
// style="max-height:…" attribute rendered via dangerouslySetInnerHTML, so its style
// is parsed from markup and subject to this policy.
const CONTENT_SECURITY_POLICY =
  "default-src 'self'; connect-src 'self' https://clinicaltables.nlm.nih.gov; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'";

// Inject the CSP as a <meta http-equiv> into the built HTML only. `apply: 'build'`
// keeps it out of `vite dev`, whose HMR/React-refresh preamble is an inline script
// that `script-src 'self'` would otherwise block — dev must stay unencumbered because
// the maintainer verifies changes in the dev server. Prepending to <head> ensures the
// policy is parsed before the injected script/style/link tags it needs to govern.
function contentSecurityPolicy(): Plugin {
  return {
    name: 'stemma-csp-meta',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: {
            'http-equiv': 'Content-Security-Policy',
            content: CONTENT_SECURITY_POLICY,
          },
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [react(), contentSecurityPolicy()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    css: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/main.tsx', 'src/**/*.d.ts'],
    },
  },
});
