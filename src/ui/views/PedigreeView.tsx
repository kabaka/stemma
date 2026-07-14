import { memo, useId, useMemo, useState } from 'react';
import { useStore, type Relation } from '@/store/useStore';
import { useCatalog } from '../hooks';
import { computeLayout, segments } from '@/domain/graph';
import { condIds, defaultOrgans, genderOf, hasCond, sabLabel, sabOf } from '@/domain/person';
import { CATEGORIES, categoryColor } from '@/data/categories';
import { PersonDrawer } from '../components/PersonDrawer';
import { HighlightBar, type HlMode } from '../components/PedigreeHighlight';
import type { Catalog } from '@/domain/catalog';
import type { CategoryKey, Gender, Person, Sab } from '@/domain/types';
import type { Palette } from '@/data/categories';

/** Node glyph size, in px — natural (unscaled) size, matching the prototype's readable
 * scale. The canvas scrolls; it never shrinks nodes to fit the panel. */
const NODE = 44;

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
  const catalog = useCatalog();

  const [adding, setAdding] = useState(false);
  const [hlMode, setHlModeRaw] = useState<HlMode>('cond');
  // The active condition id (mode 'cond') or category key (mode 'cat'). The prototype
  // tracks these as two separate nullable fields, but they're never both set at
  // once — a single slot, reinterpreted by `hlMode`, makes that invariant structural
  // instead of something every setter has to remember to uphold.
  const [activeId, setActiveId] = useState<string | null>(null);

  // A fresh install (and resetRecord()) now yields a record holding only the proband —
  // no fictional relatives. Show a friendly prompt instead of an empty tree.
  const isEmpty = record.people.length === 1;

  const { pos, cw, ch, gens, minGen, segs } = useMemo(() => {
    const layout = computeLayout(record.people);
    return { ...layout, segs: segments(record.unions, layout.pos) };
  }, [record.people, record.unions]);

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

  const handleLoadSample = (): void => {
    if (window.confirm('Load the example family? This replaces your current record.')) {
      loadSample();
    }
  };
  const handleResetToEmpty = (): void => {
    if (window.confirm('Reset to empty? This removes everyone but you.')) {
      resetRecord();
    }
  };

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
          <h1 className="page-title">Family Pedigree</h1>
          {/* The empty state below has its own, more prominent "+ Add relative" /
              "Load example family" affordances, so this cluster only adds value once
              there's a tree to manage — showing both here and there would be redundant. */}
          {!isEmpty && (
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn btn--sm" onClick={handleLoadSample}>
                Load example family
              </button>
              <button
                type="button"
                className="btn btn--sm"
                style={{ color: 'var(--sev-referral)', borderColor: 'rgba(255,93,93,0.4)' }}
                onClick={handleResetToEmpty}
              >
                Reset to empty
              </button>
              <button
                type="button"
                className="btn btn--primary btn--sm"
                aria-expanded={adding}
                onClick={() => setAdding((v) => !v)}
              >
                {adding ? '✕ close' : '+ add relative'}
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

        {adding && <AddRelative onDone={() => setAdding(false)} />}

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
          <EmptyState onAdd={() => setAdding(true)} onLoadSample={loadSample} />
        ) : (
          <div className="pedigree-scroll">
            <div
              className="pedigree-canvas"
              role="group"
              aria-label="Family pedigree chart"
              style={{ width: cw, height: ch }}
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
                  <div key={g} className="pedigree-gen-label" style={{ top: pos[rep.id].y + 14 }}>
                    Gen {g - minGen + 1}
                  </div>
                );
              })}
              {record.people.map((p) => (
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
          <span className="overline" style={{ display: 'block', marginBottom: 8 }}>
            Legend
          </span>
          <CategoryLegend categories={presentCategories} palette={palette} />
        </div>
      )}

      {/* key remounts the drawer per person so its local edit/search state never bleeds across selections. */}
      {selectedId && <PersonDrawer key={selectedId} personId={selectedId} />}
    </div>
  );
}

/** Shown when the record holds only the proband — never auto-loads the fictional
 * example family; the user opts in explicitly. */
function EmptyState({ onAdd, onLoadSample }: { onAdd: () => void; onLoadSample: () => void }) {
  return (
    <div className="pedigree-empty">
      <h2 style={{ fontSize: 17, fontWeight: 600 }}>Start your family history</h2>
      <p style={{ fontSize: 13, color: 'var(--text-dim)', maxWidth: 380, lineHeight: 1.5 }}>
        Add relatives one at a time — parents, siblings, children. Stemma looks for hereditary
        patterns as the tree grows.
      </p>
      <div className="row" style={{ gap: 10, marginTop: 6 }}>
        <button type="button" className="btn btn--primary" onClick={onAdd}>
          + Add relative
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

/** Accessible name for a pedigree node: identity plus affected state, since the node's
 * only other affected-category signal is fill hue (WCAG 1.4.1 — colour is never the sole
 * channel). When a highlight is active, matching nodes say so too, since the dimming of
 * non-matches is otherwise a sighted-only cue. */
function nodeLabel(person: Person, catalog: Catalog, hlActive: boolean, matches: boolean): string {
  const ids = condIds(person);
  let base: string;
  if (ids.length === 0) {
    base = `${person.name}, unaffected`;
  } else {
    const meta = catalog.get(ids[0]);
    const catLabel = CATEGORIES[meta.cat].label.toLowerCase();
    base = `${person.name}, affected: ${meta.name} (${catLabel})`;
  }
  return hlActive && matches ? `${base} · highlighted` : base;
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
  const initColor = affected ? '#08121a' : 'var(--text)';
  const border = selected ? 'var(--accent)' : proband ? 'var(--text)' : '#6b7280';
  const borderWidth = selected || proband ? 2.5 : 1.5;
  const ring = selected
    ? '0 0 0 3px rgba(111,168,255,0.35)'
    : matches && hlColor
      ? `0 0 0 3px ${hlColor}66`
      : proband
        ? '0 0 0 3px rgba(52,226,207,0.25)'
        : undefined;

  const sabDiffers =
    sab !== 'u' && ((g === 'man' && sab !== 'm') || (g === 'woman' && sab !== 'f') || g === 'nb');
  const years = person.dead
    ? `${person.birth ?? '?'}–${person.death ?? '?'}`
    : person.birth != null
      ? `b.${person.birth}`
      : '';
  const dots = ids.slice(0, 4).map((id) => categoryColor(catalog.get(id).cat, palette));
  const dimmed = hlActive && !matches;
  const label = nodeLabel(person, catalog, hlActive, matches);

  return (
    <div
      className="pedigree-node-wrap"
      style={{ left: x - NODE / 2, top: cy - NODE / 2, opacity: dimmed ? 0.28 : 1 }}
    >
      <button
        type="button"
        className="pedigree-node"
        aria-label={label}
        onClick={() => onSelect(person.id)}
        style={{
          borderRadius: shape === 'circle' ? '50%' : 7,
          transform: shape === 'diamond' ? 'rotate(45deg)' : undefined,
          background: fill,
          border: `${borderWidth}px solid ${border}`,
          boxShadow: ring,
        }}
      >
        <span
          aria-hidden="true"
          className="pedigree-node__init"
          style={{
            color: initColor,
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

const RELATIONS: { id: Relation; label: string }[] = [
  { id: 'child', label: 'Child' },
  { id: 'partner', label: 'Partner' },
  { id: 'sibling', label: 'Sibling' },
  { id: 'parent', label: 'Parent' },
];

/** Inline form to add a relative anchored to a chosen person. */
function AddRelative({ onDone }: { onDone: () => void }) {
  const record = useStore((s) => s.record);
  const addRelative = useStore((s) => s.addRelative);
  const selectPerson = useStore((s) => s.selectPerson);

  const [anchor, setAnchor] = useState(record.probandId);
  const [relation, setRelation] = useState<Relation>('child');
  const [name, setName] = useState('');
  const [sab, setSab] = useState<Sab>('f');
  const [gender, setGender] = useState<Gender>('woman');
  // Kept as a string so the field can be blanked while typing without snapping to 0.
  const [birth, setBirth] = useState('2000');

  const anchorId = useId();
  const relationId = useId();
  const nameId = useId();
  const birthId = useId();
  const sabId = useId();
  const genderId = useId();

  const submit = () => {
    if (!name.trim()) return;
    const birthYear = Number.parseInt(birth, 10);
    const id = addRelative(anchor, relation, {
      name,
      sab,
      gender,
      dead: false,
      birth: Number.isNaN(birthYear) ? null : birthYear,
      death: null,
      condIds: [],
      organs: defaultOrgans(sab),
    });
    if (id) selectPerson(id);
    onDone();
  };

  return (
    <div className="card" style={{ marginBottom: 16, display: 'grid', gap: 12 }}>
      <div className="row wrap" style={{ gap: 12 }}>
        <div>
          <label className="lbl" htmlFor={anchorId}>
            Relative of
          </label>
          <select
            id={anchorId}
            className="field"
            style={{ width: 'auto' }}
            value={anchor}
            onChange={(e) => setAnchor(e.target.value)}
          >
            {record.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="lbl" htmlFor={relationId}>
            Relation
          </label>
          <select
            id={relationId}
            className="field"
            style={{ width: 'auto' }}
            value={relation}
            onChange={(e) => setRelation(e.target.value as Relation)}
          >
            {RELATIONS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="row wrap" style={{ gap: 12 }}>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label className="lbl" htmlFor={nameId}>
            Name
          </label>
          <input
            id={nameId}
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label className="lbl" htmlFor={birthId}>
            Birth year
          </label>
          <input
            id={birthId}
            className="field"
            style={{ width: 110 }}
            type="number"
            value={birth}
            onChange={(e) => setBirth(e.target.value)}
          />
        </div>
      </div>
      <div className="row wrap" style={{ gap: 12 }}>
        <div>
          <label className="lbl" htmlFor={sabId}>
            Sex assigned at birth
          </label>
          <select
            id={sabId}
            className="field"
            style={{ width: 'auto' }}
            value={sab}
            onChange={(e) => setSab(e.target.value as Sab)}
          >
            <option value="f">AFAB</option>
            <option value="m">AMAB</option>
            <option value="u">Unknown</option>
          </select>
        </div>
        <div>
          <label className="lbl" htmlFor={genderId}>
            Gender
          </label>
          <select
            id={genderId}
            className="field"
            style={{ width: 'auto' }}
            value={gender}
            onChange={(e) => setGender(e.target.value as Gender)}
          >
            <option value="woman">Woman</option>
            <option value="man">Man</option>
            <option value="nb">Nonbinary</option>
          </select>
        </div>
      </div>
      <div className="row">
        <button type="button" className="btn btn--primary btn--sm" onClick={submit}>
          Add relative
        </button>
        <button type="button" className="btn btn--sm" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}
