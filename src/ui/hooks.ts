/** Derived-state hooks shared across views. Keep computation in the domain layer;
 * these just memoise it against the current store. */
import { useEffect, useRef, type RefObject } from 'react';
import { CURRENT_YEAR, useStore } from '@/store/useStore';
import { buildCatalog, type Catalog } from '@/domain/catalog';
import { detectPatterns, familyFindings, relationMap, type PatternFlag } from '@/domain/patterns';
import { calculatorsFor, scheduleFor, screeningsFor } from '@/domain/screening';
import type { RelationInfo } from '@/domain/graph';

/**
 * Focus management for a disclosure (an inline panel or form that mounts on demand):
 * move focus into the panel on open, and hand it back to whatever triggered the open
 * on close, so keyboard/screen-reader focus is never silently dropped to `<body>`.
 * Mirrors the pattern in `PersonDrawer`; return the ref and spread it onto the element
 * that should receive focus (typically the first field). WCAG 2.4.3.
 */
export function useDisclosureFocus<T extends HTMLElement>(): RefObject<T | null> {
  const ref = useRef<T>(null);
  useEffect(() => {
    const trigger = document.activeElement;
    const triggerEl = trigger instanceof HTMLElement ? trigger : null;
    ref.current?.focus();
    return () => triggerEl?.focus();
  }, []);
  return ref;
}

/** The merged catalog (curated + long-tail extensions). */
export function useCatalog(): Catalog {
  const extensions = useStore((s) => s.extensions);
  return buildCatalog(extensions);
}

/** As-of year used for all age math. */
export function useAsOfYear(): number {
  return CURRENT_YEAR;
}

/** Relationship of every person to a given root. */
export function useRelations(rootId: string): Map<string, RelationInfo> {
  const record = useStore((s) => s.record);
  return relationMap(record, rootId);
}

/** Hereditary-pattern flags from a vantage. */
export function useFlags(rootId: string): PatternFlag[] {
  const record = useStore((s) => s.record);
  const catalog = useCatalog();
  const asOf = useAsOfYear();
  return detectPatterns(record, catalog, rootId, asOf);
}

/** Per-condition family findings from a vantage. */
export function useFindings(rootId: string) {
  const record = useStore((s) => s.record);
  const catalog = useCatalog();
  return familyFindings(record, catalog, rootId);
}

/** Organ-driven screenings for a vantage. */
export function useScreenings(rootId: string) {
  const record = useStore((s) => s.record);
  return screeningsFor(record, rootId);
}

/** Cadence-bearing screenings for a vantage, resolved against the guideline schedule. */
export function useSchedule(rootId: string) {
  const record = useStore((s) => s.record);
  const asOf = useAsOfYear();
  return scheduleFor(record, rootId, asOf);
}

/** External calculators seeded by the family history. */
export function useCalculators(rootId: string) {
  const record = useStore((s) => s.record);
  return calculatorsFor(record, rootId);
}
