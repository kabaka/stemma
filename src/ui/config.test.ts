/**
 * Oracle for `buildTimeSmartClientId` — the sole `import.meta.env` read for DR-0016's
 * build-time SMART client id seam. `vi.stubEnv` overrides `import.meta.env.*` for the
 * duration of a test (restored by `vi.unstubAllEnvs` below), so this exercises the real
 * trim/empty/undefined branches without needing a real build.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildTimeSmartClientId } from './config';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('buildTimeSmartClientId', () => {
  it('returns null when VITE_SMART_CLIENT_ID is unset (the fork/local-dev path)', () => {
    vi.stubEnv('VITE_SMART_CLIENT_ID', undefined);
    expect(buildTimeSmartClientId()).toBeNull();
  });

  it('returns null for an empty or whitespace-only value', () => {
    vi.stubEnv('VITE_SMART_CLIENT_ID', '   ');
    expect(buildTimeSmartClientId()).toBeNull();
  });

  it('returns the trimmed value when set', () => {
    vi.stubEnv('VITE_SMART_CLIENT_ID', '  my-epic-client-id  ');
    expect(buildTimeSmartClientId()).toBe('my-epic-client-id');
  });
});
