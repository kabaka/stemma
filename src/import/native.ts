/**
 * Native backup restore — the inverse of {@link buildNativeBackup}.
 *
 * Reads a Stemma native backup envelope (see `src/export/native.ts`) back into a
 * {@link FamilyRecord} and its catalog {@link Condition | extensions}, validating at the
 * boundary so a malformed or hostile file can never overwrite good state. The store's
 * `replaceRecord` applies the same record guard again on the way in — belt and braces.
 *
 * Pure; no I/O (the UI reads the file text and hands it here). Never throws: every failure
 * mode is returned as a structured {@link NativeRestore} error so the panel can report it.
 */
import { isValidRecord } from '@/domain/record';
import { sanitizeExtensions } from '@/domain/catalog';
import type { Condition, FamilyRecord } from '@/domain/types';

// The backup-format contract, restated here rather than imported: the layering rule bars
// `import/` from depending on `export/`. These must stay in lock-step with the canonical
// definitions in `src/export/native.ts` (a co-located test asserts they round-trip).
const NATIVE_BACKUP_KIND = 'stemma.backup';
const NATIVE_BACKUP_VERSION = 1;

export interface NativeRestore {
  /** The restored record + extensions, or null when the file could not be restored. */
  data: { record: FamilyRecord; extensions: Condition[] } | null;
  /** Human-readable problems (a hard failure sets `data` to null; soft ones don't). */
  warnings: string[];
}

const fail = (message: string): NativeRestore => ({ data: null, warnings: [message] });

/**
 * Parse and validate a native backup file's text.
 *
 * @param text Raw file contents (JSON).
 */
export function parseNativeBackup(text: string): NativeRestore {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail('That file is not valid JSON. Choose a Stemma backup (.json) file.');
  }

  if (!parsed || typeof parsed !== 'object') {
    return fail('That file is not a Stemma backup.');
  }

  const env = parsed as {
    kind?: unknown;
    version?: unknown;
    record?: unknown;
    extensions?: unknown;
  };

  if (env.kind !== NATIVE_BACKUP_KIND) {
    return fail('That file is not a Stemma backup (unrecognised format).');
  }

  const warnings: string[] = [];
  if (typeof env.version === 'number' && env.version > NATIVE_BACKUP_VERSION) {
    warnings.push(
      `This backup was made by a newer version of Stemma (format v${env.version}). Some data may not load correctly.`,
    );
  }

  if (!isValidRecord(env.record)) {
    return fail('This backup is missing a valid family record and cannot be restored.');
  }

  // Extensions are best-effort: drop anything malformed rather than reject the whole file,
  // since a bad long-tail entry shouldn't cost the user their whole record. The shared
  // guard drops malformed shapes, unknown categories, curated-id collisions, and duplicates.
  const extensions = sanitizeExtensions(env.extensions);
  if (Array.isArray(env.extensions)) {
    const dropped = env.extensions.length - extensions.length;
    if (dropped > 0) {
      warnings.push(
        `${dropped} custom ${dropped === 1 ? 'condition was' : 'conditions were'} skipped (malformed, an unknown category, or a duplicate of a built-in condition).`,
      );
    }
  }

  return { data: { record: env.record, extensions }, warnings };
}
