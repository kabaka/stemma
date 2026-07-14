import { describe, it, expect } from 'vitest';
import { buildPedigreeSvg } from './pedigree-svg';
import { seedRecord } from '@/data/seed';
import { buildCatalog } from '@/store/useStore';

const catalog = buildCatalog([]);

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
});
