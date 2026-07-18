/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
import { fileURLToPath, URL } from 'node:url';

// The site is served from https://kabaka.github.io/stemma/ on GitHub Pages,
// so built asset URLs must be prefixed with the repo name. Local dev uses '/'.
const base = process.env.GITHUB_PAGES === 'true' ? '/stemma/' : '/';

// Content-Security-Policy — local-first hardening (docs/AUDIT.md, security lens).
// Runtime network egress is user-triggered only: the NLM vocabulary lookup and the
// opt-in SMART-on-FHIR import (DR-0019/DR-0020). Because a SMART client must reach
// whichever provider FHIR/token endpoint the user names, connect-src cannot be a
// static per-host allowlist and a build-time <meta> CSP cannot be widened at runtime;
// connect-src is therefore 'self' https: — the narrowest workable relaxation, which
// still blocks http:/data:/blob:/ws: egress. script-src stays 'self' only (no inline,
// no eval — verified against the built bundle); form-action 'none', object-src 'none',
// and base-uri 'self' are unchanged (the OAuth authorize step is a top-level
// navigation CSP fetch-directives do not govern). style-src keeps 'unsafe-inline'
// because the exported pedigree SVG carries an inline style="max-height:…" attribute
// rendered via dangerouslySetInnerHTML, so its style is parsed from markup and subject
// to this policy.
const CONTENT_SECURITY_POLICY =
  "default-src 'self'; connect-src 'self' https:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'";

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

// React Compiler — auto-memoizes components/hooks that follow the Rules of React,
// so manual useMemo/useCallback/memo can be dropped where the compiler subsumes them.
// @vitejs/plugin-react v6 transforms with oxc (no `babel` option), so the compiler is
// run through @rolldown/plugin-babel using the plugin's own `reactCompilerPreset`. The
// preset carries a per-file filter (only React code is handed to Babel) and targets
// React 19's built-in `react/compiler-runtime`. `include` scopes Babel to the UI layer —
// React lives only in src/ui/ (see the layering contract in CLAUDE.md), so the pure
// domain/data/export layers are never handed to Babel. (The dedicated React Compiler
// lint suite isn't in oxlint's rule set; oxlint still enforces react/rules-of-hooks and
// react/exhaustive-deps — see .oxlintrc.json — which is what the kept useCallbacks below
// satisfy.)
// https://react.dev/learn/react-compiler/installation
export default defineConfig({
  base,
  plugins: [
    react(),
    babel({ include: /[\\/]src[\\/]ui[\\/]/, presets: [reactCompilerPreset()] }),
    contentSecurityPolicy(),
  ],
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
