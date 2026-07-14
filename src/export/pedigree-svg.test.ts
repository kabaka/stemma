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
});
