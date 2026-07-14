import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Catalog } from '@/domain/catalog';
import type { CategoryKey, Person } from '@/domain/types';
import type { Palette } from '@/data/categories';
import { CATEGORIES, categoryColor } from '@/data/categories';
import { condIds } from '@/domain/person';

/** Condition spotlights one condition id; category spotlights every condition in a
 * clinical category. Mutually exclusive — see {@link HighlightBar}'s `activeId`. */
export type HlMode = 'cond' | 'cat';

interface ChipData {
  id: string;
  name: string;
  color: string;
  count: number;
}

/** Conditions present in the family, one chip per id, sorted by prevalence (most
 * affected people first, then name) — mirrors the prototype's `condChips`. */
function conditionChipsFor(people: Person[], catalog: Catalog, palette: Palette): ChipData[] {
  const counts = new Map<string, number>();
  for (const p of people) for (const id of condIds(p)) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts.entries()]
    .sort(
      ([aId, aCount], [bId, bCount]) =>
        bCount - aCount || catalog.get(aId).name.localeCompare(catalog.get(bId).name),
    )
    .map(([id, count]) => ({
      id,
      name: catalog.get(id).name,
      color: categoryColor(catalog.get(id).cat, palette),
      count,
    }));
}

/** Categories present in the family, one chip per category — count is the number of
 * people with *any* condition in that category (deduped per person), matching the
 * prototype's `catChips`. */
function categoryChipsFor(people: Person[], catalog: Catalog, palette: Palette): ChipData[] {
  const counts = new Map<CategoryKey, number>();
  for (const p of people) {
    const seen = new Set(condIds(p).map((id) => catalog.get(id).cat));
    for (const cat of seen) counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(
      ([aCat, aCount], [bCat, bCount]) =>
        bCount - aCount || CATEGORIES[aCat].label.localeCompare(CATEGORIES[bCat].label),
    )
    .map(([cat, count]) => ({
      id: cat,
      name: CATEGORIES[cat].label,
      color: categoryColor(cat, palette),
      count,
    }));
}

/**
 * The "Highlight" control row above the pedigree canvas: a Condition/Category mode
 * toggle, chips for what's present in the family (sorted by prevalence), a full-catalog
 * search popover, and a clear button. Purely local view state — the parent only needs
 * `mode` + `activeId` to dim non-matching nodes.
 */
export function HighlightBar({
  mode,
  onSetMode,
  activeId,
  onToggleChip,
  onHighlightCondition,
  onClear,
  people,
  catalog,
  palette,
}: {
  mode: HlMode;
  onSetMode: (m: HlMode) => void;
  /** The active condition id (mode 'cond') or category key (mode 'cat'), or null. */
  activeId: string | null;
  /** Toggle a chip on/off — id is a condition id or category key depending on `mode`. */
  onToggleChip: (id: string) => void;
  /** Always-set (never toggle-off) selection from the search popover. */
  onHighlightCondition: (id: string) => void;
  onClear: () => void;
  people: Person[];
  catalog: Catalog;
  palette: Palette;
}) {
  const chips = useMemo(
    () =>
      mode === 'cond'
        ? conditionChipsFor(people, catalog, palette)
        : categoryChipsFor(people, catalog, palette),
    [mode, people, catalog, palette],
  );
  const [searchOpen, setSearchOpen] = useState(false);
  const searchToggleRef = useRef<HTMLButtonElement>(null);

  // Category mode has no search popover — close it if the mode changes out from under it.
  useEffect(() => {
    if (mode !== 'cond') setSearchOpen(false);
  }, [mode]);

  const closeSearch = (): void => {
    setSearchOpen(false);
    searchToggleRef.current?.focus();
  };

  return (
    <div
      className="row wrap"
      role="group"
      aria-label="Highlight a condition or category"
      style={{ gap: 8, marginTop: 16, position: 'relative' }}
    >
      <span className="overline">Highlight</span>

      <div role="group" aria-label="Highlight mode" className="row" style={{ gap: 4 }}>
        <button
          type="button"
          className="chip"
          aria-pressed={mode === 'cond'}
          onClick={() => onSetMode('cond')}
        >
          Condition
        </button>
        <button
          type="button"
          className="chip"
          aria-pressed={mode === 'cat'}
          onClick={() => onSetMode('cat')}
        >
          Category
        </button>
      </div>

      {chips.map((c) => (
        <button
          key={c.id}
          type="button"
          className="chip pedigree-hl-chip"
          aria-pressed={activeId === c.id}
          onClick={() => onToggleChip(c.id)}
        >
          <span className="pedigree-hl-swatch" aria-hidden="true" style={{ background: c.color }} />
          <span>{c.name}</span>
          <span className="pedigree-hl-count">{c.count}</span>
        </button>
      ))}

      {mode === 'cond' && (
        <div style={{ position: 'relative' }}>
          <button
            ref={searchToggleRef}
            type="button"
            className="chip"
            style={{ borderStyle: 'dashed' }}
            aria-expanded={searchOpen}
            onClick={() => setSearchOpen((v) => !v)}
          >
            ⌕ search all conditions
          </button>
          {searchOpen && (
            <ConditionSearchPopover
              catalog={catalog}
              palette={palette}
              onSelect={(id) => {
                onHighlightCondition(id);
                closeSearch();
              }}
              onClose={closeSearch}
            />
          )}
        </div>
      )}

      {activeId != null && (
        <button type="button" className="btn btn--sm" onClick={onClear}>
          ✕ clear
        </button>
      )}
    </div>
  );
}

/** Full-catalog condition search, for highlighting a condition that isn't already a
 * chip. Long-tail vocabulary search is out of scope here — the curated+extension
 * catalog is enough (`catalog.search`). */
function ConditionSearchPopover({
  catalog,
  palette,
  onSelect,
  onClose,
}: {
  catalog: Catalog;
  palette: Palette;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  // Move focus into the popover on open, matching the drawer's own focus discipline.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = catalog.search(query, undefined, 40);

  return (
    <div
      className="pedigree-hl-search-popover"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <label className="visually-hidden" htmlFor={inputId}>
        Search all conditions
      </label>
      <input
        id={inputId}
        ref={inputRef}
        className="field"
        style={{ marginBottom: 8 }}
        placeholder="Search 120+ conditions…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div
        role="status"
        style={{
          maxHeight: 280,
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        {results.map((r) => (
          <button
            key={r.id}
            type="button"
            className="btn btn--sm"
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            onClick={() => onSelect(r.id)}
          >
            <span className="row" style={{ gap: 8 }}>
              <span
                aria-hidden="true"
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 2,
                  background: categoryColor(r.cat, palette),
                  flex: 'none',
                }}
              />
              {r.name}
            </span>
            <span className="mono-dim">{r.categoryLabel}</span>
          </button>
        ))}
        {query.trim() !== '' && results.length === 0 && (
          <div className="mono-dim" style={{ padding: '8px 4px', fontStyle: 'italic' }}>
            No matching condition.
          </div>
        )}
      </div>
    </div>
  );
}
