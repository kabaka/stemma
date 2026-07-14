import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useStore } from '@/store/useStore';
import { useCatalog } from '../hooks';
import { computeLayout, segments } from '@/domain/graph';
import { condIds, genderOf, hasCond, sabLabel, sabOf } from '@/domain/person';
import { CATEGORIES, categoryColor } from '@/data/categories';
import { PersonDrawer } from '../components/PersonDrawer';
import { GedcomImport } from '../components/GedcomImport';
import { PersonForm, type PersonFormState } from '../components/PersonForm';
import { HighlightBar, type HlMode } from '../components/PedigreeHighlight';
import type { Catalog } from '@/domain/catalog';
import type { CategoryKey, FamilyRecord, Gender, Person, Sab } from '@/domain/types';
import type { Palette } from '@/data/categories';

/** Node glyph size, in px — natural (unscaled) size, matching the prototype's readable
 * scale. The canvas scrolls; it never shrinks nodes to fit the panel. Fed to the CSS box
 * size via the `--node-size` custom property set on `.pedigree-canvas` below, so the
 * position math here and the box size in components.css read from one number and can
 * never drift apart. */
const NODE = 44;

/** `CSSProperties` doesn't type custom properties — this narrows the cast to exactly
 * the one variable the canvas sets. */
interface CanvasStyle extends CSSProperties {
  '--node-size': string;
}

const CONFIRM_LOAD_SAMPLE = 'Load the example family? This replaces your current record.';
const CONFIRM_IMPORT = 'Import this family tree? This replaces your current record.';

/** True only for the record's untouched default shape — a single proband still named
 * "You", with no birth year and no conditions recorded. The one case where swapping it
 * out for the example family is genuinely lossless, so the empty state's own load
 * button can skip the confirmation the header button always shows. `people.length ===
 * 1` alone isn't a safe stand-in for "nothing to lose": a user can add a relative, edit
 * their own proband record, then delete the relative and land right back at one
 * (edited) person. */
function isPristineRecord(record: FamilyRecord): boolean {
  if (record.people.length !== 1) return false;
  const [p] = record.people;
  return p.name === 'You' && p.birth == null && p.conds.length === 0;
}

/** Whether a person's sex assigned at birth differs from what their gender would imply
 * by default — the 2022 NSGC annotation trigger for both the node's visual "AFAB"/
 * "AMAB" tag and its accessible name (`nodeLabel`), computed once so the two can never
 * drift apart. Deliberately excludes 'u' (not recorded): that's the untouched default
 * proband's "nothing entered yet", not a meaningful difference to flag — so this view
 * suppresses the tag where the SVG export's equivalent `sabDiff` check (no 'u' gate,
 * see `src/export/pedigree-svg.ts`) would still show one for an explicitly-recorded
 * "Unknown" sab. That's an intentional, narrow divergence between the two surfaces. */
function sabAnnotationDiffers(person: Person): boolean {
  const g = genderOf(person);
  const sab = sabOf(person);
  return (
    sab !== 'u' && ((g === 'man' && sab !== 'm') || (g === 'woman' && sab !== 'f') || g === 'nb')
  );
}

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG relative luminance of a `#rrggbb` colour. */
function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two `#rrggbb` colours. */
function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [lighter, darker] = la > lb ? [la, lb] : [lb, la];
  return (lighter + 0.05) / (darker + 0.05);
}

// Deliberately the true luminance extremes, not the theme's softer `#08121a`/`--text`
// ink tones used elsewhere: this is the one spot that must clear 4.5:1 against an
// arbitrary, unpredictable fill colour (any category × either palette), and the softer
// tones don't reliably get there. Worst case across all 14 categories × both palettes —
// the colorblind palette's "blood" fill (#C0407A) — is ~3.83:1 against `#08121a` alone
// and only ~4.09:1 against the better of `#08121a`/`--text`, both still short of 4.5:1;
// picking the better of the two true extremes clears it at ~4.94:1.
const INITIALS_DARK = '#000000';
const INITIALS_LIGHT = '#ffffff';

/** Initials colour for a filled (affected) node: whichever of black or white has
 * higher contrast against THIS fill, so every category clears 4.5:1 (WCAG 1.4.3) — a
 * single hardcoded tone didn't. */
function initialsColor(fill: string): string {
  if (!fill.startsWith('#')) return 'var(--text)';
  return contrastRatio(fill, INITIALS_DARK) >= contrastRatio(fill, INITIALS_LIGHT)
    ? INITIALS_DARK
    : INITIALS_LIGHT;
}

/** Opacity applied to a non-matching node's coloured glyph (fill + initials) under an
 * active highlight filter — never to its border or the name/years text outside the
 * button, which stay at full contrast regardless (WCAG 1.4.3). */
const DIM_OPACITY = 0.28;

/** The family pedigree: a natural-size, scrollable canvas (never scaled to fit) with a
 * Highlight control to spotlight a condition or category, plus an editing drawer for
 * the selected person. Glyphs follow 2022 NSGC notation: gender drives shape,
 * sex-assigned-at-birth is annotated when it differs. */
export function PedigreeView() {
  const record = useStore((s) => s.record);
  const palette = useStore((s) => s.palette);
  const selectedId = useStore((s) => s.selectedId);
  const selectPerson = useStore((s) => s.selectPerson);
  const loadSample = useStore((s) => s.loadSample);
  const resetRecord = useStore((s) => s.resetRecord);
  const replaceRecord = useStore((s) => s.replaceRecord);
  const catalog = useCatalog();

  const [importing, setImporting] = useState(false);
  const [formState, setFormState] = useState<PersonFormState | null>(null);
  const [hlMode, setHlModeRaw] = useState<HlMode>('cond');
  // The active condition id (mode 'cond') or category key (mode 'cat'). The prototype
  // tracks these as two separate nullable fields, but they're never both set at
  // once — a single slot, reinterpreted by `hlMode`, makes that invariant structural
  // instead of something every setter has to remember to uphold.
  const [activeId, setActiveId] = useState<string | null>(null);

  // A fresh install (and resetRecord()) now yields a record holding only the proband —
  // no fictional relatives. Show a friendly prompt instead of an empty tree.
  const isEmpty = record.people.length === 1;

  const titleRef = useRef<HTMLHeadingElement>(null);
  const prevIsEmpty = useRef(isEmpty);
  const prevImporting = useRef(importing);
  // loadSample()/resetRecord()/import swap the record without unmounting this view, so
  // whatever was focused — the header's own "Reset to empty"/"Load example family", or
  // the empty state's — can vanish out from under the user, dropping focus to <body>.
  // Same when the import panel closes (Cancel/Submit unmount it). Move focus to the stable
  // page heading on exactly those transitions: never on mount, and never when the panel
  // merely *opens* (its toggle button stays put). Add/edit doesn't need a case here —
  // PersonForm is a modal that manages its own open/close focus (see PersonForm.tsx).
  useEffect(() => {
    const emptyChanged = prevIsEmpty.current !== isEmpty;
    const importClosed = prevImporting.current && !importing;
    if (emptyChanged || importClosed) titleRef.current?.focus();
    prevIsEmpty.current = isEmpty;
    prevImporting.current = importing;
  }, [isEmpty, importing]);

  // Deleting a person unmounts their pedigree node AND its drawer/modal in the same commit,
  // so the focus-return refs those layers captured now point at detached nodes — .focus()
  // is a no-op and focus falls to <body>. The ordinary close paths (Escape/✕/backdrop)
  // leave the node in place and hand focus back to it, so only deletion needs catching
  // here: when the prior selection clears AND that person is gone, pull focus to the
  // stable page heading (the same anchor the empty-state transition above uses).
  const prevSelectedId = useRef(selectedId);
  useEffect(() => {
    const prev = prevSelectedId.current;
    prevSelectedId.current = selectedId;
    if (prev && !selectedId && !record.people.some((p) => p.id === prev)) {
      titleRef.current?.focus();
    }
  }, [selectedId, record.people]);

  const { pos, cw, ch, gens, minGen, segs } = useMemo(() => {
    const layout = computeLayout(record.people);
    return { ...layout, segs: segments(record.unions, layout.pos) };
  }, [record.people, record.unions]);

  // Tab order follows DOM order, not the absolute positioning below — sort by the
  // computed layout position (generation, then horizontal position) so keyboard users
  // move through the tree the way sighted users scan it, regardless of the order
  // relatives happen to sit in the underlying record (a newly-added relative is
  // appended to the array, not inserted by generation).
  const orderedPeople = useMemo(
    () => [...record.people].sort((a, b) => a.gen - b.gen || pos[a.id].x - pos[b.id].x),
    [record.people, pos],
  );

  const presentCategories = useMemo(
    () => legendCategories(record.people, catalog),
    [record.people, catalog],
  );

  const setHlMode = (m: HlMode): void => {
    setHlModeRaw(m);
    setActiveId(null);
  };
  const toggleChip = (id: string): void => {
    setActiveId((cur) => (cur === id ? null : id));
  };
  const highlightCondition = (id: string): void => {
    setHlModeRaw('cond');
    setActiveId(id);
  };
  const clearHighlight = (): void => setActiveId(null);

  const hlActive = activeId != null;
  let hlColor: string | null = null;
  if (activeId != null) {
    hlColor =
      hlMode === 'cat'
        ? categoryColor(activeId as CategoryKey, palette)
        : categoryColor(catalog.get(activeId).cat, palette);
  }
  const nodeMatches = (p: Person): boolean => {
    if (activeId == null) return false;
    if (hlMode === 'cat') return condIds(p).some((id) => catalog.get(id).cat === activeId);
    return hasCond(p, activeId);
  };

  // loadSample()/resetRecord()/import swap the whole record without unmounting this view,
  // so the local highlight/form/import state above must be cleared on every swap —
  // otherwise a stale `activeId` outlives the record it was computed against (nothing in
  // the new record matches it, so the whole tree dims with no chip showing as active), a
  // stale PersonForm `anchor`/`id` can mis-attach to or edit a person from the old record,
  // and the import panel would linger. Every record-swap entry point — the header buttons,
  // the empty state's own loader, and GEDCOM import — routes through this helper.
  const swapRecord = (action: () => void): void => {
    action();
    setActiveId(null);
    setFormState(null);
    setImporting(false);
  };

  // Toggle the import panel. Add/edit is a blocking modal (not a header panel), so there's
  // no sibling panel to close here.
  const openImporting = (): void => setImporting((v) => !v);

  const handleLoadSample = (): void => {
    if (window.confirm(CONFIRM_LOAD_SAMPLE)) swapRecord(loadSample);
  };
  const handleResetToEmpty = (): void => {
    if (window.confirm('Reset to empty? This removes everyone but you.')) {
      swapRecord(resetRecord);
    }
  };
  // `isEmpty` (people.length === 1) means "just the proband", not "nothing to lose" —
  // see isPristineRecord. Only skip the confirmation when the record is still the
  // untouched default; otherwise prompt exactly like the header button does.
  const handleEmptyLoadSample = (): void => {
    if (isPristineRecord(record) || window.confirm(CONFIRM_LOAD_SAMPLE)) swapRecord(loadSample);
  };
  // GEDCOM import replaces the whole record, so it gets the same destructive-swap guard as
  // "Load example family" — skipped only when the record is still the untouched default.
  const handleGedcomImport = (imported: FamilyRecord): void => {
    if (isPristineRecord(record) || window.confirm(CONFIRM_IMPORT)) {
      swapRecord(() => replaceRecord(imported));
    }
  };

  const canvasStyle: CanvasStyle = { width: cw, height: ch, '--node-size': `${NODE}px` };

  return (
    // Plain positioning wrapper — App already renders <main className="main"> around every
    // view, so this must not carry the .main class too (that would stack two identical flex
    // containers). It still needs the .main layout properties inlined so the pinned header +
    // scrollable canvas below and the drawer's height:100% overlay behave exactly as before.
    <div
      style={{
        position: 'relative',
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div className="pedigree-header">
        <div className="page-head">
          <h1 className="page-title" tabIndex={-1} ref={titleRef}>
            Family Pedigree
          </h1>
          {/* The empty state below has its own, more prominent "+ Add relative" /
              "Load example family" affordances, so this cluster only adds value once
              there's a tree to manage — showing both here and there would be redundant. */}
          {!isEmpty && (
            <div className="row wrap" style={{ gap: 8 }}>
              <button
                type="button"
                className="btn btn--sm"
                aria-expanded={importing}
                onClick={openImporting}
              >
                {importing ? '✕ close import' : 'Import GEDCOM'}
              </button>
              <button type="button" className="btn btn--sm" onClick={handleLoadSample}>
                Load example family
              </button>
              <button
                type="button"
                className="btn btn--sm btn--danger"
                onClick={handleResetToEmpty}
              >
                Reset to empty
              </button>
              <button
                type="button"
                className="btn btn--primary btn--sm"
                aria-haspopup="dialog"
                onClick={() =>
                  setFormState({ mode: 'add', anchor: record.probandId, relation: 'child' })
                }
              >
                + add relative
              </button>
            </div>
          )}
        </div>
        <p className="lede">
          2022 gender-inclusive notation — circle = woman, square = man, diamond = nonbinary; sex
          assigned at birth is noted when it differs. Filled = affected, coloured by condition
          category; diagonal = deceased. Stemma surfaces patterns worth a clinician&rsquo;s
          attention — <b>not a diagnostic device</b>. Click any relative to view or edit their
          record.
        </p>

        {importing && (
          <GedcomImport onImport={handleGedcomImport} onCancel={() => setImporting(false)} />
        )}

        {!isEmpty && (
          <HighlightBar
            mode={hlMode}
            onSetMode={setHlMode}
            activeId={activeId}
            onToggleChip={toggleChip}
            onHighlightCondition={highlightCondition}
            onClear={clearHighlight}
            people={record.people}
            catalog={catalog}
            palette={palette}
          />
        )}
      </div>

      <div className="pedigree-body">
        {isEmpty ? (
          <EmptyState
            onAdd={() => setFormState({ mode: 'add', anchor: record.probandId, relation: 'child' })}
            onEditSelf={() => setFormState({ mode: 'edit', id: record.probandId })}
            onImport={openImporting}
            onLoadSample={handleEmptyLoadSample}
          />
        ) : (
          <div className="pedigree-scroll">
            <div
              className="pedigree-canvas"
              role="group"
              aria-label="Family pedigree chart"
              style={canvasStyle}
            >
              <svg
                width={cw}
                height={ch}
                style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}
                aria-hidden="true"
                pointerEvents="none"
              >
                {segs.map((s, i) => (
                  <line
                    key={i}
                    x1={s.x1}
                    y1={s.y1}
                    x2={s.x2}
                    y2={s.y2}
                    stroke="#6b7280"
                    strokeWidth={1.3}
                  />
                ))}
              </svg>
              {gens.map((g) => {
                const rep = record.people.find((p) => p.gen === g);
                if (!rep) return null;
                return (
                  <div
                    key={g}
                    className="pedigree-gen-label"
                    aria-hidden="true"
                    style={{ top: pos[rep.id].y + 14 }}
                  >
                    Gen {g - minGen + 1}
                  </div>
                );
              })}
              {orderedPeople.map((p) => (
                <PedigreeNode
                  key={p.id}
                  person={p}
                  x={pos[p.id].x}
                  cy={pos[p.id].cy}
                  selected={p.id === selectedId}
                  proband={p.id === record.probandId}
                  catalog={catalog}
                  palette={palette}
                  hlActive={hlActive}
                  matches={hlActive && nodeMatches(p)}
                  hlColor={hlColor}
                  onSelect={selectPerson}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {!isEmpty && presentCategories.length > 0 && (
        <div className="pedigree-footer">
          <h2 className="overline" style={{ display: 'block', marginBottom: 8 }}>
            Legend
          </h2>
          <CategoryLegend categories={presentCategories} palette={palette} />
        </div>
      )}

      {/* key remounts the drawer per person so its local edit/search state never bleeds across selections. */}
      {selectedId && (
        <PersonDrawer key={selectedId} personId={selectedId} onOpenForm={(s) => setFormState(s)} />
      )}

      {/* key remounts the modal per open request, so its local field state can never
          carry over from one add/edit into the next (see PersonForm's own mount-time
          initialization). */}
      {formState && (
        <PersonForm key={formKey(formState)} state={formState} onClose={() => setFormState(null)} />
      )}
    </div>
  );
}

/** Stable per-open-request key for {@link PersonForm} — see the render call site. */
function formKey(state: PersonFormState): string {
  return state.mode === 'edit' ? `edit:${state.id}` : `add:${state.anchor}:${state.relation}`;
}

/** Shown when the record holds only the proband — never auto-loads the fictional
 * example family; the user opts in explicitly. */
function EmptyState({
  onAdd,
  onEditSelf,
  onImport,
  onLoadSample,
}: {
  onAdd: () => void;
  onEditSelf: () => void;
  onImport: () => void;
  onLoadSample: () => void;
}) {
  return (
    <div className="pedigree-empty">
      <h2 style={{ fontSize: 17, fontWeight: 600 }}>Start your family history</h2>
      <p style={{ fontSize: 13, color: 'var(--text-dim)', maxWidth: 380, lineHeight: 1.5 }}>
        Add relatives one at a time — parents, siblings, children — fill in your own details first,
        or import a family tree you already have (GEDCOM, e.g. from Ancestry). Stemma looks for
        hereditary patterns as the tree grows.
      </p>
      <div className="row wrap" style={{ gap: 10, marginTop: 6 }}>
        <button type="button" className="btn btn--primary" aria-haspopup="dialog" onClick={onAdd}>
          + Add relative
        </button>
        <button type="button" className="btn" aria-haspopup="dialog" onClick={onEditSelf}>
          Edit your details
        </button>
        <button type="button" className="btn" onClick={onImport}>
          Import GEDCOM
        </button>
        <button type="button" className="btn" onClick={onLoadSample}>
          Load example family
        </button>
      </div>
    </div>
  );
}

/** Condition categories actually present in the record, in the catalog's canonical order. */
function legendCategories(people: Person[], catalog: Catalog): CategoryKey[] {
  const present = new Set<CategoryKey>();
  for (const p of people) {
    for (const id of condIds(p)) present.add(catalog.get(id).cat);
  }
  return (Object.keys(CATEGORIES) as CategoryKey[]).filter((k) => present.has(k));
}

/** Visible category-colour key so fill hue is never the only signal (WCAG 1.4.1). */
function CategoryLegend({ categories, palette }: { categories: CategoryKey[]; palette: Palette }) {
  if (categories.length === 0) return null;
  return (
    <ul className="pedigree-legend" role="list" aria-label="Condition category legend">
      {categories.map((cat) => (
        <li className="pedigree-legend__item" role="listitem" key={cat}>
          <span
            className="pedigree-legend__swatch"
            aria-hidden="true"
            style={{ background: categoryColor(cat, palette) }}
          />
          {CATEGORIES[cat].label}
        </li>
      ))}
    </ul>
  );
}

/** Accessible name for a pedigree node — everything a sighted user reads visually
 * (deceased/birth years, the sex-assigned-at-birth annotation, the proband's "you" tag,
 * every condition, and highlight-match state) folded into one sentence, since all of
 * that is otherwise conveyed only by `aria-hidden` glyphs/text or colour alone (WCAG
 * 1.1.1 / 1.4.1). Every condition is named, not just the first — an active highlight
 * can match on any of a person's conditions (e.g. their second), and naming only the
 * first would silently fail to say why a match lit up. */
function nodeLabel(
  person: Person,
  catalog: Catalog,
  hlActive: boolean,
  matches: boolean,
  proband: boolean,
): string {
  const parts: string[] = [person.name];
  if (proband) parts.push('you');

  if (person.dead) {
    parts.push(`died ${person.death ?? 'unknown year'}`);
    if (person.birth != null) parts.push(`born ${person.birth}`);
  } else if (person.birth != null) {
    parts.push(`born ${person.birth}`);
  }

  if (sabAnnotationDiffers(person)) {
    parts.push(`sex assigned at birth ${sabLabel(sabOf(person))}`);
  }

  const ids = condIds(person);
  if (ids.length === 0) {
    parts.push('unaffected');
  } else {
    const names = ids.map((id, i) => {
      const meta = catalog.get(id);
      return i === 0 ? `${meta.name} (${CATEGORIES[meta.cat].label.toLowerCase()})` : meta.name;
    });
    parts.push(`affected: ${names.join(', ')}`);
  }

  const base = parts.join(', ');
  return hlActive && matches ? `${base}, highlighted` : base;
}

interface NodeProps {
  person: Person;
  x: number;
  cy: number;
  selected: boolean;
  proband: boolean;
  catalog: Catalog;
  palette: Palette;
  hlActive: boolean;
  matches: boolean;
  hlColor: string | null;
  onSelect: (id: string) => void;
}

/** A single pedigree glyph, absolutely positioned at natural size. Memoized: `person` /
 * `pos` stay referentially stable across pure selection/highlight interactions (neither
 * mutates the record), so this skips re-rendering the (potentially many) nodes whose
 * visual state didn't actually change — `onSelect` is the store's `selectPerson` action
 * directly (already stable) rather than a per-node closure, to keep that comparison valid. */
const PedigreeNode = memo(function PedigreeNode({
  person,
  x,
  cy,
  selected,
  proband,
  catalog,
  palette,
  hlActive,
  matches,
  hlColor,
  onSelect,
}: NodeProps) {
  const g: Gender = genderOf(person);
  const sab: Sab = sabOf(person);
  const shape: 'circle' | 'square' | 'diamond' =
    g === 'woman' ? 'circle' : g === 'nb' ? 'diamond' : 'square';
  const ids = condIds(person);
  const affected = ids.length > 0;

  // Affected = filled with the first condition's category colour; unaffected = outline
  // only. Condition dots (below) separately show every category the person carries.
  const fill = affected ? categoryColor(catalog.get(ids[0]).cat, palette) : 'transparent';
  const initColor = affected ? initialsColor(fill) : 'var(--text)';
  const border = selected ? 'var(--accent)' : proband ? 'var(--text)' : '#6b7280';
  const borderWidth = selected || proband ? 2.5 : 1.5;
  const ring = selected
    ? '0 0 0 3px rgba(111,168,255,0.35)'
    : matches && hlColor
      ? `0 0 0 3px ${hlColor}66`
      : proband
        ? '0 0 0 3px rgba(52,226,207,0.25)'
        : undefined;

  const sabDiffers = sabAnnotationDiffers(person);
  const years = person.dead
    ? `${person.birth ?? '?'}–${person.death ?? '?'}`
    : person.birth != null
      ? `b.${person.birth}`
      : '';
  const dots = ids.slice(0, 4).map((id) => categoryColor(catalog.get(id).cat, palette));
  const extraConditions = ids.length - dots.length;
  const dimmed = hlActive && !matches;
  const label = nodeLabel(person, catalog, hlActive, matches, proband);

  return (
    <div className="pedigree-node-wrap" style={{ left: x - NODE / 2, top: cy - NODE / 2 }}>
      <button
        type="button"
        className="pedigree-node"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={selected}
        onClick={() => onSelect(person.id)}
        style={{
          borderRadius: shape === 'circle' ? '50%' : 7,
          transform: shape === 'diamond' ? 'rotate(45deg)' : undefined,
          border: `${borderWidth}px solid ${border}`,
          boxShadow: ring,
        }}
      >
        {/* Only the coloured glyph — fill + initials — de-emphasizes under a highlight
            filter (WCAG 1.4.3): the border above and the name/years below always stay
            full-contrast, so a dimmed relative's identity and shape stay legible; only
            "does this person match the current highlight" fades. */}
        <span
          aria-hidden="true"
          className="pedigree-node__fill"
          style={{
            borderRadius: shape === 'circle' ? '50%' : 7,
            background: fill,
            opacity: dimmed ? DIM_OPACITY : 1,
          }}
        />
        <span
          aria-hidden="true"
          className="pedigree-node__init"
          style={{
            color: initColor,
            opacity: dimmed ? DIM_OPACITY : 1,
            transform: shape === 'diamond' ? 'rotate(-45deg)' : undefined,
          }}
        >
          {person.name.slice(0, 2)}
        </span>
      </button>
      {person.dead && <span aria-hidden="true" className="pedigree-node__slash" />}
      {dots.length > 0 && (
        <span aria-hidden="true" className="pedigree-node__dots">
          {dots.map((c, i) => (
            <span key={i} className="pedigree-node__dot" style={{ background: c }} />
          ))}
          {extraConditions > 0 && (
            <span className="pedigree-node__dot-more">+{extraConditions}</span>
          )}
        </span>
      )}
      {proband && (
        <span aria-hidden="true" className="pedigree-node__you">
          YOU
        </span>
      )}
      {sabDiffers && (
        <span aria-hidden="true" className="pedigree-node__sab">
          {sabLabel(sab)}
        </span>
      )}
      <div aria-hidden="true" className="pedigree-node__name">
        {person.name}
      </div>
      {years && (
        <div aria-hidden="true" className="pedigree-node__years">
          {years}
        </div>
      )}
    </div>
  );
});
