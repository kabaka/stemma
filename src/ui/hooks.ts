/** Derived-state hooks shared across views. Keep computation in the domain layer;
 * these just memoise it against the current store. */
import { useMemo } from 'react';
import { buildCatalog, CURRENT_YEAR, useStore } from '@/store/useStore';
import type { Catalog } from '@/domain/catalog';
import { detectPatterns, familyFindings, relationMap, type PatternFlag } from '@/domain/patterns';
import { calculatorsFor, screeningsFor } from '@/domain/screening';
import type { RelationInfo } from '@/domain/graph';

/** The merged catalog (curated + long-tail extensions). */
export function useCatalog(): Catalog {
  const extensions = useStore((s) => s.extensions);
  return useMemo(() => buildCatalog(extensions), [extensions]);
}

/** As-of year used for all age math. */
export function useAsOfYear(): number {
  return CURRENT_YEAR;
}

/** Relationship of every person to a given root. */
export function useRelations(rootId: string): Map<string, RelationInfo> {
  const record = useStore((s) => s.record);
  return useMemo(() => relationMap(record, rootId), [record, rootId]);
}

/** Hereditary-pattern flags from a vantage. */
export function useFlags(rootId: string): PatternFlag[] {
  const record = useStore((s) => s.record);
  const catalog = useCatalog();
  const asOf = useAsOfYear();
  return useMemo(
    () => detectPatterns(record, catalog, rootId, asOf),
    [record, catalog, rootId, asOf],
  );
}

/** Per-condition family findings from a vantage. */
export function useFindings(rootId: string) {
  const record = useStore((s) => s.record);
  const catalog = useCatalog();
  return useMemo(() => familyFindings(record, catalog, rootId), [record, catalog, rootId]);
}

/** Organ-driven screenings for a vantage. */
export function useScreenings(rootId: string) {
  const record = useStore((s) => s.record);
  return useMemo(() => screeningsFor(record, rootId), [record, rootId]);
}

/** External calculators seeded by the family history. */
export function useCalculators(rootId: string) {
  const record = useStore((s) => s.record);
  return useMemo(() => calculatorsFor(record, rootId), [record, rootId]);
}
