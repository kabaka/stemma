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
import { CATEGORY_LABELS } from '@/data/categories';
import { CONDITIONS } from '@/data/conditions';
import type { Condition, FamilyRecord } from '@/domain/types';

// The backup-format contract, restated here rather than imported: the layering rule bars
// `import/` from depending on `export/`. These must stay in lock-step with the canonical
// definitions in `src/export/native.ts` (a co-located test asserts they round-trip).
const NATIVE_BACKUP_KIND = 'stemma.backup';
const NATIVE_BACKUP_VERSION = 1;

const VALID_CATEGORIES = new Set<string>(Object.keys(CATEGORY_LABELS));
/** Curated ids an extension must never redefine (see `registerCondition`'s same guard). */
const CURATED_IDS = new Set(CONDITIONS.map((c) => c.id));

export interface NativeRestore {
  /** The restored record + extensions, or null when the file could not be restored. */
  data: { record: FamilyRecord; extensions: Condition[] } | null;
  /** Human-readable problems (a hard failure sets `data` to null; soft ones don't). */
  warnings: string[];
}

/**
 * Structural + safety check for a catalog extension. Beyond field types, `cat` must be a
 * real {@link CategoryKey}: an unknown category would crash the pedigree/highlight views,
 * which index `CATEGORIES[cat].label` unguarded. An extension that fails this is dropped;
 * any person condition referencing its id then resolves through the catalog's safe
 * `fallbackCondition` (category `'other'`) instead.
 */
function isConditionLike(c: unknown): c is Condition {
  if (!c || typeof c !== 'object') return false;
  const cond = c as Partial<Condition>;
  return (
    typeof cond.id === 'string' &&
    typeof cond.name === 'string' &&
    typeof cond.cat === 'string' &&
    VALID_CATEGORIES.has(cond.cat) &&
    typeof cond.base === 'number' &&
    typeof cond.pattern === 'string'
  );
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
  // since a bad long-tail entry shouldn't cost the user their whole record.
  let extensions: Condition[] = [];
  if (Array.isArray(env.extensions)) {
    const wellFormed = env.extensions.filter(isConditionLike);
    // Never let an extension redefine a curated condition. `buildCatalog` merges
    // `[...CONDITIONS, ...extensions]` into a last-write-wins map, so a colliding id would
    // silently overwrite curated clinical metadata (e.g. an inheritance pattern the engine
    // reads) — the exact invariant `registerCondition` guards. Also dedupe extensions by id.
    const seen = new Set<string>();
    extensions = wellFormed.filter((c) => {
      if (CURATED_IDS.has(c.id) || seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
    const dropped = env.extensions.length - extensions.length;
    if (dropped > 0) {
      warnings.push(
        `${dropped} custom ${dropped === 1 ? 'condition was' : 'conditions were'} skipped (malformed, an unknown category, or a duplicate of a built-in condition).`,
      );
    }
  }

  return { data: { record: env.record, extensions }, warnings };
}
