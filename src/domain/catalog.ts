/**
 * The condition catalog: a lookup + ranked search over the curated conditions,
 * merged with any long-tail conditions the user has attached via live vocabulary
 * search. `get()` always resolves — unknown ids yield a generic fallback so the rest
 * of the engine can treat curated and long-tail codes uniformly.
 */
import type { CategoryKey, Condition } from './types';
import { CONDITIONS, COMMON_CONDITIONS } from '@/data/conditions';
import { CATEGORY_LABELS } from '@/data/categories';

export interface CatalogHit {
  id: string;
  name: string;
  categoryLabel: string;
  cat: CategoryKey;
}

export interface Catalog {
  /** Every known condition (curated + user extensions), deduped by id. */
  all: Condition[];
  /** Resolve an id to a condition, falling back to a generic record for unknown ids. */
  get(id: string): Condition;
  /** Whether the id is a known (non-fallback) condition. */
  has(id: string): boolean;
  /** Ranked search; `exclude` hides already-selected ids. */
  search(query: string, exclude?: Set<string>, cap?: number): CatalogHit[];
}

/** Generic stand-in for an id with no catalog metadata (e.g. a raw ICD-10 code). */
export function fallbackCondition(id: string): Condition {
  return { id, name: id, cat: 'other', base: 0, pattern: '—' };
}

const VALID_CATEGORIES = new Set<string>(Object.keys(CATEGORY_LABELS));
const CURATED_IDS = new Set(CONDITIONS.map((c) => c.id));

/** Whether `c` is a well-formed long-tail {@link Condition} with a real category. */
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

/**
 * Sanitise a set of long-tail catalog extensions from an untrusted source (a restored
 * backup, a future FHIR-pull). Keeps only well-formed conditions with a real category,
 * drops any id that collides with a curated condition (an extension must never shadow
 * curated clinical metadata the engine reads — the same invariant `registerCondition`
 * enforces), and dedupes by id. Any dropped entry's id resolves through the catalog's
 * safe {@link fallbackCondition} (`'other'`) instead. Non-array input yields `[]`.
 *
 * The single guard reused at every boundary that admits externally-sourced extensions,
 * so a new producer can't reintroduce the shadow/crash risk by forgetting to filter.
 */
export function sanitizeExtensions(input: unknown): Condition[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: Condition[] = [];
  for (const c of input) {
    if (!isConditionLike(c) || CURATED_IDS.has(c.id) || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}

/**
 * Build a catalog. `common` is the ordered set of ids shown when the search box is
 * empty. `categoryLabels` maps category keys to display names.
 */
export function createCatalog(
  conditions: Condition[],
  common: string[],
  categoryLabels: Record<CategoryKey, string>,
): Catalog {
  const map = new Map<string, Condition>();
  for (const c of conditions) map.set(c.id, c);
  const all = [...map.values()];

  const categoryLabel = (id: string): string => {
    const c = map.get(id);
    return c ? categoryLabels[c.cat] : 'Other';
  };
  const toHit = (c: Condition): CatalogHit => ({
    id: c.id,
    name: c.name,
    categoryLabel: categoryLabel(c.id),
    cat: c.cat,
  });

  return {
    all,
    has: (id) => map.has(id),
    get: (id) => map.get(id) ?? fallbackCondition(id),
    search(query, exclude, cap) {
      const q = (query ?? '').trim().toLowerCase();
      const ex = exclude ?? new Set<string>();
      if (!q) {
        return common
          .filter((id) => map.has(id) && !ex.has(id))
          .map((id) => toHit(map.get(id)!))
          .slice(0, cap ?? 14);
      }
      const scored: { c: Condition; s: number }[] = [];
      for (const c of map.values()) {
        if (ex.has(c.id)) continue;
        const name = c.name.toLowerCase();
        const syn = (c.syn ?? []).map((s) => s.toLowerCase());
        let s = -1;
        if (name === q) s = 100;
        else if (name.startsWith(q)) s = 80;
        else if (name.split(/[^a-z0-9]+/).some((w) => w.startsWith(q))) s = 62;
        else if (syn.some((y) => y.startsWith(q))) s = 58;
        else if (name.includes(q)) s = 42;
        else if (syn.some((y) => y.includes(q))) s = 30;
        if (s >= 0) scored.push({ c, s });
      }
      scored.sort((a, b) => b.s - a.s || a.c.name.localeCompare(b.c.name));
      return scored.slice(0, cap ?? 40).map((o) => toHit(o.c));
    },
  };
}

/**
 * Build the default catalog: the curated conditions merged with any long-tail
 * `extensions` the user attached via vocabulary search. Pure — lives in the core so
 * the export layer and future import pipelines can assemble a catalog without reaching
 * up into the store.
 */
export function buildCatalog(extensions: Condition[] = []): Catalog {
  return createCatalog([...CONDITIONS, ...extensions], [...COMMON_CONDITIONS], CATEGORY_LABELS);
}
