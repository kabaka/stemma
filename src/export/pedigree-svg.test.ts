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
// Name-label fitting — a long name wraps to at most two <tspan>s within the H_GAP-derived
// character budget, while the full name always survives (unwrapped) in a <title>.
// ---------------------------------------------------------------------------

describe('person-name label fitting (printout-export-improvements)', () => {
  /** Count of <tspan entries in `svg` — one per rendered name line for that node. */
  const countTspans = (svg: string): number => (svg.match(/<tspan/g) ?? []).length;

  it('wraps a long multi-word name onto two <tspan>s (dy="0" and dy="12") behind one <title>', () => {
    const longName = 'Alexandria Bartholomew Fitzgerald';
    const svg = buildPedigreeSvg(soloRecord({ name: longName }), catalog);
    expect(svg).toContain(`<title>${longName}</title>`);
    expect(svg).toContain('dy="0"');
    expect(svg).toContain('dy="12"');
    expect(countTspans(svg)).toBe(2);
  });

  it('keeps a short name (<= budget, no space) as a single <tspan>, with the full name in <title>', () => {
    const shortName = 'Sam';
    const svg = buildPedigreeSvg(soloRecord({ name: shortName }), catalog);
    expect(svg).toContain(`<title>${shortName}</title>`);
    expect(countTspans(svg)).toBe(1);
    expect(svg).toContain(`>${shortName}</tspan>`);
    // Only the years/sab line's own content follows — no second name line was emitted.
    expect(svg).not.toContain('dy="12"');
  });

  it('truncates a single over-long token (no spaces) with an ellipsis, but <title> keeps the original', () => {
    // 30 chars, no whitespace — exceeds LABEL_BUDGET (14) as a single "word" that can't be
    // wrapped onto a second line, so fitNameLines must truncate it in place.
    const longToken = 'Supercalifragilisticexpialidoc';
    const svg = buildPedigreeSvg(soloRecord({ name: longToken }), catalog);
    expect(svg).toContain(`<title>${longToken}</title>`);
    // The truncated tspan is shorter than the original and ends in the ellipsis character.
    const tspanMatch = svg.match(/<tspan[^>]*dy="0">([^<]*)<\/tspan>/);
    expect(tspanMatch).toBeTruthy();
    const rendered = tspanMatch![1];
    expect(rendered.endsWith('…')).toBe(true);
    expect(rendered.length).toBeLessThan(longToken.length);
    // The untruncated token appears exactly once in the whole document — inside <title> —
    // never as the visible tspan text.
    expect(svg.split(longToken)).toHaveLength(2);
    // Single line — a lone over-long token has no remainder to wrap onto a second line.
    expect(countTspans(svg)).toBe(1);
  });

  it('renders an empty name as a single, empty <tspan> without crashing', () => {
    const svg = buildPedigreeSvg(soloRecord({ name: '' }), catalog);
    expect(svg).toContain('<title></title>');
    expect(countTspans(svg)).toBe(1);
    expect(svg).toContain('dy="0"></tspan>');
    expect(svg).not.toContain('…');
  });

  it('renders an all-whitespace name as a single, empty <tspan> without crashing', () => {
    const svg = buildPedigreeSvg(soloRecord({ name: '   ' }), catalog);
    // The full (unescaped) whitespace name still rides along in <title>.
    expect(svg).toContain('<title>   </title>');
    expect(countTspans(svg)).toBe(1);
    expect(svg).toContain('dy="0"></tspan>');
    expect(svg).not.toContain('…');
  });

  it('keeps a name exactly at the 14-char budget on one line, untruncated', () => {
    // LABEL_BUDGET = floor(H_GAP / 6.5) = floor(96 / 6.5) = 14 — a single word of exactly
    // 14 chars fits the `next.length > budget` check (14 > 14 is false) and must not be
    // treated as an overrun.
    const exactName = 'X'.repeat(14);
    expect(exactName).toHaveLength(14);
    const svg = buildPedigreeSvg(soloRecord({ name: exactName }), catalog);
    expect(svg).toContain(`<title>${exactName}</title>`);
    expect(countTspans(svg)).toBe(1);
    expect(svg).toContain(`>${exactName}</tspan>`);
    expect(svg).not.toContain('…');
  });

  /** Two generations, no union between them (irrelevant to this geometry assertion) — just
   * enough structure to have a genuine "bottom row" whose cy sits well below the top row's
   * (GEN_HEIGHT=170 in graph.ts dwarfs the 12px wrap addition), so the bottom node's label
   * height dominates the viewBox regardless of whether it wraps. */
  function twoGenRecord(bottomName: string): FamilyRecord {
    const top: Person = {
      id: 'top',
      name: 'Top',
      sab: 'f',
      gender: 'woman',
      gen: 0,
      x: 0,
      dead: false,
      birth: 1970,
      death: null,
      conds: [],
    };
    const bottom: Person = {
      id: 'bottom',
      name: bottomName,
      sab: 'f',
      gender: 'woman',
      gen: 1,
      x: 0,
      dead: false,
      birth: 2000,
      death: null,
      conds: [],
      isProband: true,
    };
    return { people: [top, bottom], unions: [], timeline: [], probandId: 'bottom' };
  }

  /** Height (`h` component) of the SVG's `viewBox="minX minY w h"` attribute. */
  function viewBoxHeight(svg: string): number {
    const m = svg.match(/viewBox="[^"]+ [^"]+ [^"]+ ([\d.]+)"/);
    if (!m) throw new Error('no viewBox found');
    return Number(m[1]);
  }

  it('grows the wrap-aware viewBox height by exactly 12px when the bottom-row name wraps', () => {
    const shortSvg = buildPedigreeSvg(twoGenRecord('Bo'), catalog);
    const wrappedSvg = buildPedigreeSvg(twoGenRecord('Alexandria Bartholomew'), catalog);
    // Confirm the premise: two nodes each contribute one <tspan> (single-line) in the short
    // variant; the bottom node's name wraps to two <tspan>s in the wrapped variant, so the
    // top node's fixed one plus the bottom's two makes three.
    expect(countTspans(shortSvg)).toBe(2);
    expect(countTspans(wrappedSvg)).toBe(3);
    expect(viewBoxHeight(wrappedSvg)).toBe(viewBoxHeight(shortSvg) + 12);
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
