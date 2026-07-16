import { describe, it, expect } from 'vitest';
import { buildPedigreeSvg } from './pedigree-svg';
import { seedRecord } from '@/data/seed';
import { buildCatalog } from '@/domain/catalog';
import type { FamilyRecord, Person } from '@/domain/types';

const catalog = buildCatalog([]);

/** A single-person record (no unions), so any <line> can only come from the deceased
 * slash overlay and any glyph shape is unambiguously that one person's. */
function soloRecord(person: Partial<Person>): FamilyRecord {
  const p: Person = {
    id: 'solo',
    name: 'Solo',
    sab: 'f',
    gender: 'woman',
    gen: 0,
    x: 0,
    dead: false,
    birth: 2000,
    death: null,
    conds: [],
    isProband: true,
    ...person,
  };
  return { people: [p], unions: [], timeline: [], probandId: p.id };
}

describe('buildPedigreeSvg', () => {
  it('returns an SVG document with node glyphs and the proband arrow', () => {
    const svg = buildPedigreeSvg(seedRecord(), catalog);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('<circle'); // gender-woman nodes
    expect(svg).toContain('<rect'); // gender-man nodes
    expect(svg).toContain('marker id="ar"');
    expect(svg).toContain('url(#ar)'); // proband arrow marker
  });

  it('drives affected fill from the palette', () => {
    const def = buildPedigreeSvg(seedRecord(), catalog, { palette: 'default' });
    const cb = buildPedigreeSvg(seedRecord(), catalog, { palette: 'colorblind' });
    expect(def).not.toBe(cb);
    // Cardiovascular fill (Robert's coronary disease) changes with the palette.
    expect(def).toContain('#ff5d5d');
    expect(def).not.toContain('#D55E00');
    expect(cb).toContain('#D55E00');
  });

  it('annotates sex assigned at birth when it differs from gender identity (Ray: AFAB, gender man)', () => {
    const svg = buildPedigreeSvg(seedRecord(), catalog);
    expect(svg).toContain('AFAB');
  });

  it("renders a square (rect, unrotated) glyph for a 'man' gender identity", () => {
    const svg = buildPedigreeSvg(soloRecord({ gender: 'man', sab: 'm' }), catalog);
    expect(svg).toContain('<rect');
    expect(svg).not.toContain('rotate(45');
  });

  it("rotates the square 45° into a diamond for a 'nb' (nonbinary) gender identity", () => {
    const svg = buildPedigreeSvg(soloRecord({ gender: 'nb', sab: 'u' }), catalog);
    expect(svg).toContain('transform="rotate(45');
  });

  it('draws a slash line through a deceased person', () => {
    // No unions at all in this fixture, so segments() contributes zero <line>s — any
    // <line> present must be the deceased-slash overlay.
    const svg = buildPedigreeSvg(soloRecord({ dead: true, birth: 1950, death: 2020 }), catalog);
    expect(svg).toContain('<line');
  });

  it('escapes <, >, &, and " in a person’s name (the SVG is injected via dangerouslySetInnerHTML)', () => {
    const svg = buildPedigreeSvg(soloRecord({ name: 'A&B <script>"x"</script>' }), catalog);
    // The raw markup must never survive into the output string.
    expect(svg).not.toContain('<script>');
    expect(svg).not.toContain('</script>');
    // Every one of & < > " is escaped, in the order esc() applies them.
    expect(svg).toContain('A&amp;B &lt;script&gt;&quot;x&quot;&lt;/script&gt;');
  });
});

// ---------------------------------------------------------------------------
// PR 3 — the export must reflect segments()' consanguinity/twin truth, not diverge from it.
// ---------------------------------------------------------------------------

describe('consanguinity and twin notation export (PR 3 pedigree extras)', () => {
  const countLines = (svg: string): number => (svg.match(/<line/g) ?? []).length;

  function coupleRecord(consanguineous: boolean): FamilyRecord {
    const p1: Person = {
      id: 'p1',
      name: 'P1',
      sab: 'f',
      gender: 'woman',
      gen: 0,
      x: 0,
      dead: false,
      birth: 1970,
      death: null,
      conds: [],
      isProband: true,
    };
    const p2: Person = {
      id: 'p2',
      name: 'P2',
      sab: 'm',
      gender: 'man',
      gen: 0,
      x: 96,
      dead: false,
      birth: 1970,
      death: null,
      conds: [],
    };
    return {
      people: [p1, p2],
      unions: [{ parents: ['p1', 'p2'], children: [], consanguineous }],
      timeline: [],
      probandId: 'p1',
    };
  }

  it('draws a consanguineous relationship line as two parallel <line>s where a plain union draws one', () => {
    const plain = buildPedigreeSvg(coupleRecord(false), catalog);
    const consang = buildPedigreeSvg(coupleRecord(true), catalog);
    expect(countLines(plain)).toBe(1);
    expect(countLines(consang)).toBe(2);
  });

  function twinFamilyRecord(twins?: FamilyRecord['unions'][number]['twins']): FamilyRecord {
    const mk = (id: string, gen: number, overrides: Partial<Person> = {}): Person => ({
      id,
      name: id,
      sab: 'u',
      gender: 'nb',
      gen,
      x: 0,
      dead: false,
      birth: 2000,
      death: null,
      conds: [],
      ...overrides,
    });
    return {
      people: [mk('p1', 0), mk('p2', 0), mk('t1', 1, { isProband: true }), mk('t2', 1)],
      unions: [{ parents: ['p1', 'p2'], children: ['t1', 't2'], twins }],
      timeline: [],
      probandId: 't1',
    };
  }

  it('renders the twin diagonals, and the monozygotic bar as one extra <line> over the equivalent non-twin sibship', () => {
    const plain = buildPedigreeSvg(twinFamilyRecord(undefined), catalog);
    const di = buildPedigreeSvg(
      twinFamilyRecord([{ members: ['t1', 't2'], zygosity: 'di' }]),
      catalog,
    );
    const mono = buildPedigreeSvg(
      twinFamilyRecord([{ members: ['t1', 't2'], zygosity: 'mono' }]),
      catalog,
    );
    // Dizygotic diagonals 1-for-1 replace the two ordinary verticals segments() would have
    // drawn — same total line count as the non-twin sibship.
    expect(countLines(di)).toBe(countLines(plain));
    // Monozygotic adds exactly the connecting bar on top of that — so the export can't
    // silently diverge from segments() truth (e.g. by dropping the bar, or the diagonals).
    expect(countLines(mono)).toBe(countLines(plain) + 1);
  });
});
