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
  /** Category label, shown as a visible cue next to the name — set only in condition
   * mode, where `name` is a condition and the category isn't otherwise stated. Omitted
   * in category mode, where `name` already IS the category (restating it would be
   * redundant noise, not a legibility win). */
  categoryLabel?: string;
}

/** Conditions present in the family, one entry per id, sorted by prevalence (most
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
      categoryLabel: CATEGORIES[catalog.get(id).cat].label,
    }));
}

/** Categories present in the family, one entry per category — count is the number of
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

/** Accessible name for a highlight row/chip. The swatch is decorative and the count is a
 * separate trailing `<span>`, so without an explicit name the browser concatenates the
 * visible text with no separator ("Coronary heart disease4"). Spelling out the unit also
 * makes the number mean something to screen-reader users, not just announce "4". The
 * category (condition mode only — see `ChipData.categoryLabel`) is folded in too, so the
 * accessible name carries the same information the row now shows visibly. */
function chipLabel(name: string, count: number, categoryLabel?: string): string {
  const countPart = `${count} ${count === 1 ? 'person' : 'people'}`;
  return categoryLabel ? `${name}, ${categoryLabel}, ${countPart}` : `${name}, ${countPart}`;
}

/**
 * The "Highlight" control row above the pedigree canvas: a Condition/Category mode
 * toggle, a single popover trigger, and — when a highlight is active — one summary chip
 * that doubles as the clear control.
 *
 * The previous version rendered one chip per condition present in the family inline in
 * the pinned header, so a partially-completed history with many conditions wrapped the
 * row to half the screen and crushed the tree. Here the header content is O(1) in the
 * number of conditions: the present-in-family list (and the full-catalog search) moves
 * into a bounded, scrollable popover, so the header height is constant no matter how many
 * conditions have been recorded. Purely local view state — the parent still only needs
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
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const condModeRef = useRef<HTMLButtonElement>(null);
  const catModeRef = useRef<HTMLButtonElement>(null);
  const popoverWrapRef = useRef<HTMLDivElement>(null);

  // Switching mode swaps the popover's contents and clears the active highlight in the
  // parent (see PedigreeView's `setHlMode`), so close it on any mode flip.
  useEffect(() => {
    setOpen(false);
  }, [mode]);

  // Dismiss on an outside pointer-down (a click on the tree, elsewhere in the header, …).
  // Deliberately does NOT pull focus back to the trigger — the user is interacting
  // somewhere else on purpose. The keyboard paths below (Escape / select / clear) still
  // return focus, since those leave the user *at* the control. The trigger sits inside
  // this wrapper, so its own toggle click is not treated as "outside".
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent): void => {
      if (popoverWrapRef.current && !popoverWrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  const closePopover = (): void => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  // The clear control removes itself the moment it fires (it only renders while a
  // highlight is active), which would otherwise drop focus to <body>. Move focus to the
  // still-present mode toggle first — the same "focus the fallback, then change state"
  // order the popover's own close paths use.
  const handleClear = (): void => {
    onClear();
    (mode === 'cond' ? condModeRef : catModeRef).current?.focus();
  };

  const modeNoun = mode === 'cond' ? 'condition' : 'category';

  // What's highlighted, for the inline summary chip. Resolved from the catalog/category
  // metadata directly (not `chips`), so it still shows a name when the active id came
  // from full-catalog search and isn't present in the family — `catalog.get` always
  // resolves, falling back to a generic record for an unknown id.
  const activeSummary = useMemo((): { name: string; color: string } | null => {
    if (activeId == null) return null;
    if (mode === 'cat') {
      const key = activeId as CategoryKey;
      return { name: CATEGORIES[key]?.label ?? activeId, color: categoryColor(key, palette) };
    }
    const meta = catalog.get(activeId);
    return { name: meta.name, color: categoryColor(meta.cat, palette) };
  }, [activeId, mode, catalog, palette]);

  return (
    <div
      className="row wrap"
      role="group"
      aria-label="Highlight a condition or category"
      // No margin-top of its own: the caller (PedigreeView) now places this alongside the
      // pedigree notation key in one shared row and owns that row's spacing, so a margin
      // here would misalign the two against each other as flex siblings.
      style={{ gap: 8, position: 'relative' }}
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

      <div ref={popoverWrapRef} style={{ position: 'relative' }}>
        <button
          ref={triggerRef}
          type="button"
          className="chip"
          style={{ borderStyle: 'dashed' }}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span aria-hidden="true">⌕</span>{' '}
          {activeSummary ? `Change ${modeNoun}…` : `Choose a ${modeNoun}…`}
        </button>
        {open && (
          <HighlightPopover
            mode={mode}
            chips={chips}
            activeId={activeId}
            catalog={catalog}
            palette={palette}
            onToggle={(id) => {
              onToggleChip(id);
              closePopover();
            }}
            onSelect={(id) => {
              onHighlightCondition(id);
              closePopover();
            }}
            onClose={closePopover}
            onDismiss={() => setOpen(false)}
          />
        )}
      </div>

      {activeSummary && (
        <button
          type="button"
          className="chip pedigree-hl-active"
          aria-label={`Clear highlight: ${activeSummary.name}`}
          onClick={handleClear}
        >
          <span
            className="pedigree-hl-swatch"
            aria-hidden="true"
            style={{ background: activeSummary.color }}
          />
          <span aria-hidden="true">{activeSummary.name}</span>
          <span aria-hidden="true" className="pedigree-hl-active__x">
            ✕
          </span>
        </button>
      )}
    </div>
  );
}

/**
 * The bounded highlight picker: the conditions/categories present in the family (sorted
 * by prevalence, with swatch + count) and — in condition mode — a full-catalog search for
 * spotlighting something the family doesn't yet carry. Long-tail vocabulary search is out
 * of scope here; the curated+extension catalog (`catalog.search`) is enough.
 *
 * Focus discipline mirrors the drawer/modal: focus moves in on open (the search box in
 * condition mode, else the first present-in-family row, else the dialog itself when the
 * list is empty), Escape or a keyboard Tab out of the popover closes it, and picking any
 * row closes and returns focus to the trigger (via the parent's `closePopover`).
 *
 * `onClose` closes AND returns focus to the trigger (Escape / row-select); `onDismiss`
 * only closes, leaving focus where the browser is moving it — used for a Tab-out, so a
 * keyboard user tabbing forward past the last row isn't yanked back to the trigger.
 */
function HighlightPopover({
  mode,
  chips,
  activeId,
  catalog,
  palette,
  onToggle,
  onSelect,
  onClose,
  onDismiss,
}: {
  mode: HlMode;
  chips: ChipData[];
  activeId: string | null;
  catalog: Catalog;
  palette: Palette;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  onClose: () => void;
  onDismiss: () => void;
}) {
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const firstRowRef = useRef<HTMLButtonElement>(null);
  const inputId = useId();

  // Move focus into the popover on open. `mode` is fixed for this component's lifetime
  // (a mode change closes the popover in the parent, unmounting this), so this runs once.
  // The dialog root is the fallback focus target for the one state with nothing else to
  // focus — Category mode with no categories recorded yet (no search box, no rows) — so
  // focus is never silently stranded on the trigger.
  useEffect(() => {
    if (mode === 'cond' && inputRef.current) inputRef.current.focus();
    else if (firstRowRef.current) firstRowRef.current.focus();
    else rootRef.current?.focus();
  }, [mode]);

  const trimmed = query.trim();
  const results = mode === 'cond' && trimmed !== '' ? catalog.search(query, undefined, 40) : [];
  const statusMessage =
    trimmed === ''
      ? ''
      : results.length === 0
        ? 'No matching condition.'
        : `${results.length} result${results.length === 1 ? '' : 's'}`;

  const noun = mode === 'cond' ? 'condition' : 'category';

  return (
    <div
      ref={rootRef}
      className="pedigree-hl-search-popover"
      role="dialog"
      aria-label={`Highlight a ${noun}`}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
      onBlur={(e) => {
        // Close when focus leaves the popover subtree entirely (e.g. Tab past the last
        // row). `relatedTarget` is the element gaining focus — null when focus leaves the
        // window; a node still inside means focus merely moved between rows, so stay open.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onDismiss();
      }}
    >
      <div className="overline" style={{ marginBottom: 7 }}>
        In this family
      </div>
      {chips.length > 0 ? (
        <div className="pedigree-hl-list">
          {chips.map((c, i) => (
            <button
              key={c.id}
              ref={i === 0 ? firstRowRef : undefined}
              type="button"
              className="pedigree-hl-row"
              aria-pressed={activeId === c.id}
              aria-label={chipLabel(c.name, c.count, c.categoryLabel)}
              onClick={() => onToggle(c.id)}
            >
              <span
                className="pedigree-hl-swatch"
                aria-hidden="true"
                style={{ background: c.color }}
              />
              <span aria-hidden="true" className="pedigree-hl-row__name">
                {c.name}
              </span>
              {c.categoryLabel && (
                <span aria-hidden="true" className="mono-dim">
                  {c.categoryLabel}
                </span>
              )}
              <span aria-hidden="true" className="pedigree-hl-count">
                {c.count}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="mono-dim" style={{ padding: '2px 2px 4px' }}>
          No {noun === 'condition' ? 'conditions' : 'categories'} recorded yet.
        </div>
      )}

      {mode === 'cond' && (
        <div className="pedigree-hl-search">
          <label className="visually-hidden" htmlFor={inputId}>
            Search all conditions
          </label>
          <input
            id={inputId}
            ref={inputRef}
            className="field"
            placeholder="Search 120+ conditions…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {/* A short summary announces via a live region on every keystroke. The results
              list itself must NOT be inside a live region — role="status" on the ~40-row
              list would re-read every visible name on each keystroke instead of the count. */}
          <div role="status" className="visually-hidden">
            {statusMessage}
          </div>
          {trimmed !== '' && (
            <div className="pedigree-hl-list pedigree-hl-list--results">
              {results.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="pedigree-hl-row"
                  aria-label={`${r.name}, ${r.categoryLabel}`}
                  onClick={() => onSelect(r.id)}
                >
                  <span
                    className="pedigree-hl-swatch"
                    aria-hidden="true"
                    style={{ background: categoryColor(r.cat, palette) }}
                  />
                  <span aria-hidden="true" className="pedigree-hl-row__name">
                    {r.name}
                  </span>
                  <span aria-hidden="true" className="mono-dim">
                    {r.categoryLabel}
                  </span>
                </button>
              ))}
              {results.length === 0 && (
                <div className="mono-dim" style={{ padding: '8px 4px', fontStyle: 'italic' }}>
                  No matching condition.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
