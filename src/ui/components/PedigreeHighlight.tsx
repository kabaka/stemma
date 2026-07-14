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

/** Accessible name for a highlight chip. The swatch is decorative and the count is a
 * separate trailing `<span>`, so without an explicit name the browser concatenates the
 * visible text with no separator ("Coronary heart disease4"). Spelling out the unit
 * also makes the number mean something to screen-reader users, not just announce "4". */
function chipLabel(name: string, count: number): string {
  return `${name}, ${count} ${count === 1 ? 'person' : 'people'}`;
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
  const condModeRef = useRef<HTMLButtonElement>(null);
  const catModeRef = useRef<HTMLButtonElement>(null);

  // Category mode has no search popover — close it if the mode changes out from under it.
  useEffect(() => {
    if (mode !== 'cond') setSearchOpen(false);
  }, [mode]);

  const closeSearch = (): void => {
    setSearchOpen(false);
    searchToggleRef.current?.focus();
  };

  // The clear button removes itself the moment it's clicked (it only renders while
  // `activeId != null`), which would otherwise drop focus to <body>. Move focus to the
  // still-present mode toggle first — the same "focus the fallback, then change state"
  // order `closeSearch` above already uses.
  const handleClear = (): void => {
    onClear();
    (mode === 'cond' ? condModeRef : catModeRef).current?.focus();
  };

  return (
    <div
      className="row wrap"
      role="group"
      aria-label="Highlight a condition or category"
      style={{ gap: 8, marginTop: 16, position: 'relative' }}
    >
      <h2 className="overline">Highlight</h2>

      <div role="group" aria-label="Highlight mode" className="row" style={{ gap: 4 }}>
        <button
          ref={condModeRef}
          type="button"
          className="chip"
          aria-pressed={mode === 'cond'}
          onClick={() => onSetMode('cond')}
        >
          Condition
        </button>
        <button
          ref={catModeRef}
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
          aria-label={chipLabel(c.name, c.count)}
          onClick={() => onToggleChip(c.id)}
        >
          <span className="pedigree-hl-swatch" aria-hidden="true" style={{ background: c.color }} />
          <span aria-hidden="true">{c.name}</span>
          <span aria-hidden="true" className="pedigree-hl-count">
            {c.count}
          </span>
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
            <span aria-hidden="true">⌕</span> search all conditions
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
        <button type="button" className="btn btn--sm" onClick={handleClear}>
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
  const trimmed = query.trim();
  const statusMessage =
    trimmed === ''
      ? ''
      : results.length === 0
        ? 'No matching condition.'
        : `${results.length} result${results.length === 1 ? '' : 's'}`;

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
      {/* A short summary announces via a live region on every keystroke. The results
          list itself must NOT be inside a live region — role="status" on the ~40-button
          list would re-read every visible name on each keystroke instead of just the
          count. */}
      <div role="status" className="visually-hidden">
        {statusMessage}
      </div>
      <div
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
            aria-label={`${r.name}, ${r.categoryLabel}`}
            onClick={() => onSelect(r.id)}
          >
            <span className="row" aria-hidden="true" style={{ gap: 8 }}>
              <span
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
            <span aria-hidden="true" className="mono-dim">
              {r.categoryLabel}
            </span>
          </button>
        ))}
        {trimmed !== '' && results.length === 0 && (
          <div className="mono-dim" style={{ padding: '8px 4px', fontStyle: 'italic' }}>
            No matching condition.
          </div>
        )}
      </div>
    </div>
  );
}
