import { useId, useMemo, useState } from 'react';
import { useStore, type Relation } from '@/store/useStore';
import { useCatalog } from '../hooks';
import { computeLayout, segments } from '@/domain/graph';
import { condIds, defaultOrgans, genderOf, sabOf } from '@/domain/person';
import { CATEGORIES, categoryColor } from '@/data/categories';
import { PersonDrawer } from '../components/PersonDrawer';
import type { Catalog } from '@/domain/catalog';
import type { CategoryKey, Gender, Person, Sab } from '@/domain/types';
import type { Palette } from '@/data/categories';

const S = 15;

/** The family pedigree — an interactive SVG over the relationship graph, plus an
 * editing drawer for the selected person. Glyphs follow 2022 NSGC notation: gender
 * drives shape, sex-assigned-at-birth is annotated when it differs. */
export function PedigreeView() {
  const record = useStore((s) => s.record);
  const palette = useStore((s) => s.palette);
  const selectedId = useStore((s) => s.selectedId);
  const selectPerson = useStore((s) => s.selectPerson);
  const catalog = useCatalog();
  const [adding, setAdding] = useState(false);

  const { pos, cw, ch, segs } = useMemo(() => {
    const layout = computeLayout(record.people);
    return { ...layout, segs: segments(record.unions, layout.pos) };
  }, [record.people, record.unions]);

  const presentCategories = useMemo(
    () => legendCategories(record.people, catalog),
    [record.people, catalog],
  );

  return (
    // Plain positioning wrapper — App already renders <main className="main"> around every
    // view, so this must not carry the .main class too (that would stack two identical flex
    // containers). It still needs the .main layout properties inlined so .scroll's flex:1
    // scroll region and the drawer's height:100% overlay behave exactly as before.
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
      <div className="scroll">
        <div className="page-head">
          <h1 className="page-title">Family Pedigree</h1>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            aria-expanded={adding}
            onClick={() => setAdding((v) => !v)}
          >
            {adding ? '✕ close' : '+ add relative'}
          </button>
        </div>
        <p className="lede">
          Click any person to view and edit their record. Shape follows gender identity (circle =
          woman, square = man, diamond = nonbinary); sex assigned at birth is annotated where it
          differs.
        </p>

        {adding && <AddRelative onDone={() => setAdding(false)} />}

        <div className="card" style={{ overflow: 'auto', padding: 12 }}>
          <svg
            viewBox={`0 0 ${cw} ${ch}`}
            width="100%"
            style={{ maxHeight: 620, minWidth: 640 }}
            role="group"
            aria-label="Family pedigree chart"
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
            {record.people.map((p) => (
              <PedigreeNode
                key={p.id}
                person={p}
                x={pos[p.id].x}
                y={pos[p.id].cy}
                selected={p.id === selectedId}
                proband={p.id === record.probandId}
                fill={affectedFill(p, palette, catalog)}
                label={nodeLabel(p, catalog)}
                onSelect={() => selectPerson(p.id)}
              />
            ))}
          </svg>
        </div>
        <CategoryLegend categories={presentCategories} palette={palette} />
      </div>

      {/* key remounts the drawer per person so its local edit/search state never bleeds across selections. */}
      {selectedId && <PersonDrawer key={selectedId} personId={selectedId} />}
    </div>
  );
}

function affectedFill(p: Person, palette: Palette, catalog: Catalog): string {
  const ids = condIds(p);
  if (!ids.length) return '#0e1218';
  return categoryColor(catalog.get(ids[0]).cat, palette);
}

/** Accessible name for a pedigree node: identity plus affected state, since the node's
 * only other affected-category signal is fill hue (WCAG 1.4.1 — colour is never the sole
 * channel). */
function nodeLabel(person: Person, catalog: Catalog): string {
  const ids = condIds(person);
  if (ids.length === 0) return `${person.name}, unaffected`;
  const meta = catalog.get(ids[0]);
  const catLabel = CATEGORIES[meta.cat].label.toLowerCase();
  return `${person.name}, affected: ${meta.name} (${catLabel})`;
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

interface NodeProps {
  person: Person;
  x: number;
  y: number;
  selected: boolean;
  proband: boolean;
  fill: string;
  label: string;
  onSelect: () => void;
}

function PedigreeNode({ person, x, y, selected, proband, fill, label, onSelect }: NodeProps) {
  const g: Gender = genderOf(person);
  const stroke = selected ? '#34e2cf' : proband ? '#e6eaf0' : '#6b7280';
  const sw = selected || proband ? 2.6 : 1.5;
  const sab: Sab = sabOf(person);
  const sabDiffers = (g === 'man' && sab !== 'm') || (g === 'woman' && sab !== 'f') || g === 'nb';
  const years = person.dead
    ? `${person.birth ?? ''}–${person.death ?? ''}`
    : `b.${person.birth ?? ''}`;
  const sabTag = sabDiffers ? (sab === 'f' ? ' AFAB' : sab === 'm' ? ' AMAB' : '') : '';

  let shape;
  if (g === 'woman')
    shape = <circle cx={x} cy={y} r={S} fill={fill} stroke={stroke} strokeWidth={sw} />;
  else if (g === 'nb')
    shape = (
      <rect
        x={x - S}
        y={y - S}
        width={2 * S}
        height={2 * S}
        transform={`rotate(45 ${x} ${y})`}
        fill={fill}
        stroke={stroke}
        strokeWidth={sw}
      />
    );
  else
    shape = (
      <rect
        x={x - S}
        y={y - S}
        width={2 * S}
        height={2 * S}
        fill={fill}
        stroke={stroke}
        strokeWidth={sw}
      />
    );

  return (
    <g
      className="pedigree-node"
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      style={{ cursor: 'pointer' }}
    >
      {shape}
      {condIds(person).length > 1 && (
        <>
          <circle cx={x + S - 2} cy={y - S + 2} r={6} fill="#111" />
          <text
            x={x + S - 2}
            y={y - S + 2}
            fontSize={8}
            fill="#fff"
            textAnchor="middle"
            dominantBaseline="central"
            fontFamily="monospace"
          >
            {condIds(person).length}
          </text>
        </>
      )}
      {person.dead && (
        <line
          x1={x - S - 5}
          y1={y + S + 5}
          x2={x + S + 5}
          y2={y - S - 5}
          stroke={stroke}
          strokeWidth={1.6}
        />
      )}
      <text
        x={x}
        y={y + S + 15}
        fontSize={10.5}
        fill="var(--text)"
        textAnchor="middle"
        fontWeight={600}
      >
        {person.name}
      </text>
      <text
        x={x}
        y={y + S + 27}
        fontSize={8}
        fill="var(--text-faint)"
        textAnchor="middle"
        fontFamily="monospace"
      >
        {years}
        {sabTag}
      </text>
    </g>
  );
}

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
