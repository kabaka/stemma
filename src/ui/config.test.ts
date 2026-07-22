/**
 * Oracle for `buildTimeClientId` — the sole `import.meta.env` read for DR-0016's build-time
 * SMART client id seam, now resolved per vendor. `vi.stubEnv` overrides `import.meta.env.*`
 * for the duration of a test (restored by `vi.unstubAllEnvs` below), so this exercises the
 * real trim/empty/undefined branches without needing a real build.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildTimeClientId } from './config';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('buildTimeClientId', () => {
  describe('epic', () => {
    it('returns the trimmed VITE_EPIC_CLIENT_ID when set', () => {
      vi.stubEnv('VITE_EPIC_CLIENT_ID', '  my-epic-client-id  ');
      expect(buildTimeClientId('epic')).toBe('my-epic-client-id');
    });

    it('falls back to VITE_SMART_CLIENT_ID (back-compat alias) when VITE_EPIC_CLIENT_ID is unset', () => {
      vi.stubEnv('VITE_EPIC_CLIENT_ID', undefined);
      vi.stubEnv('VITE_SMART_CLIENT_ID', '  legacy-client-id  ');
      expect(buildTimeClientId('epic')).toBe('legacy-client-id');
    });

    it('prefers VITE_EPIC_CLIENT_ID over the VITE_SMART_CLIENT_ID alias when both are set', () => {
      vi.stubEnv('VITE_EPIC_CLIENT_ID', 'epic-id');
      vi.stubEnv('VITE_SMART_CLIENT_ID', 'legacy-id');
      expect(buildTimeClientId('epic')).toBe('epic-id');
    });

    it('returns null when both VITE_EPIC_CLIENT_ID and VITE_SMART_CLIENT_ID are unset (the fork/local-dev path)', () => {
      vi.stubEnv('VITE_EPIC_CLIENT_ID', undefined);
      vi.stubEnv('VITE_SMART_CLIENT_ID', undefined);
      expect(buildTimeClientId('epic')).toBeNull();
    });

    it('returns null for an empty or whitespace-only value', () => {
      vi.stubEnv('VITE_EPIC_CLIENT_ID', '   ');
      vi.stubEnv('VITE_SMART_CLIENT_ID', undefined);
      expect(buildTimeClientId('epic')).toBeNull();
    });

    // Regression: GitHub Actions evaluates an UNSET repo Variable to the EMPTY STRING, not
    // `undefined` (`VITE_EPIC_CLIENT_ID: ${{ vars.EPIC_CLIENT_ID }}` in deploy.yml is
    // unconditional), so this is the real unset-GH-Variable shape — not a hypothetical. A
    // deploy that only ever set the legacy VITE_SMART_CLIENT_ID must still resolve Epic's id;
    // `??` alone does not fall through on `''`, which is exactly the bug this guards against.
    it('falls back to VITE_SMART_CLIENT_ID when VITE_EPIC_CLIENT_ID is the empty string (unset GH Actions Variable shape)', () => {
      vi.stubEnv('VITE_EPIC_CLIENT_ID', '');
      vi.stubEnv('VITE_SMART_CLIENT_ID', 'legacy-client-id');
      expect(buildTimeClientId('epic')).toBe('legacy-client-id');
    });
  });

  describe('cerner', () => {
    it('returns the trimmed VITE_CERNER_CLIENT_ID when set', () => {
      vi.stubEnv('VITE_CERNER_CLIENT_ID', '  my-cerner-client-id  ');
      expect(buildTimeClientId('cerner')).toBe('my-cerner-client-id');
    });

    it('returns null when unset', () => {
      vi.stubEnv('VITE_CERNER_CLIENT_ID', undefined);
      expect(buildTimeClientId('cerner')).toBeNull();
    });

    it('returns null for an empty or whitespace-only value', () => {
      vi.stubEnv('VITE_CERNER_CLIENT_ID', '   ');
      expect(buildTimeClientId('cerner')).toBeNull();
    });

    // Regression: same unset-GH-Variable-is-'' shape as the Epic case above, applied to
    // Cerner — an empty string must resolve to null (Cerner has no back-compat alias to
    // fall through to), not be treated as a set-but-blank client id.
    it('returns null for the empty string (unset GH Actions Variable shape)', () => {
      vi.stubEnv('VITE_CERNER_CLIENT_ID', '');
      expect(buildTimeClientId('cerner')).toBeNull();
    });

    it('never falls back to VITE_EPIC_CLIENT_ID or VITE_SMART_CLIENT_ID', () => {
      vi.stubEnv('VITE_CERNER_CLIENT_ID', undefined);
      vi.stubEnv('VITE_EPIC_CLIENT_ID', 'epic-id');
      vi.stubEnv('VITE_SMART_CLIENT_ID', 'legacy-id');
      expect(buildTimeClientId('cerner')).toBeNull();
    });
  });
});
