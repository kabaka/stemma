/**
 * Gender-inclusive pedigree SVG export.
 *
 * Renders a standalone SVG pedigree on the 2022 NSGC (Bennett et al.) gender-inclusive
 * nomenclature — roadmap §5 (`prototype/uploads/Lineage-expansion-ideation.md`). Glyph
 * shape is driven by gender identity (circle = woman, square = man, diamond =
 * nonbinary); affected fill comes from the condition's category colour under the
 * chosen palette; deceased carry a slash, the proband an arrow, and a differing sex
 * assigned at birth is labelled beneath the node.
 *
 * Ported faithfully from the prototype's `buildPedigreeSVG`, over the shared
 * {@link computeLayout} / {@link segments} geometry. Pure; deterministic given palette.
 */
import type { Catalog } from '@/domain/catalog';
import type { FamilyRecord, Person } from '@/domain/types';
import type { Palette } from '@/data/categories';
import type { LayoutNode } from '@/domain/graph';
import { categoryColor } from '@/data/categories';
import { condIds, genderOf, sabLabel, sabOf } from '@/domain/person';
import { computeLayout, segments } from '@/domain/graph';

export interface PedigreeSvgOptions {
  palette?: Palette;
}

const NODE = 15;
const OUTLINE = '#1a1f28';
const LINE = '#3a4150';
const UNAFFECTED_FILL = '#ffffff';

// Escapes for XML text content AND attribute values (quotes included), so the same
// helper is safe if a name is ever interpolated into an attribute, not just text.
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Serialise a family record into a self-contained pedigree SVG string. */
export function buildPedigreeSvg(
  record: FamilyRecord,
  catalog: Catalog,
  opts: PedigreeSvgOptions = {},
): string {
  const palette: Palette = opts.palette ?? 'default';
  const proband = record.people.find((p) => p.id === record.probandId);
  const g0 = proband ? proband.gen : 0;
  // A four-generation window centred on the proband, matching the prototype.
  const included = record.people.filter((p) => p.gen >= g0 - 2 && p.gen <= g0 + 1);
  // Lay out only the windowed people, but with the full union set — `computeLayout` and
  // `segments` both ignore union members that fall outside `included`, so cross-window
  // parentage links are simply not drawn rather than crashing.
  const { pos } = computeLayout(included, record.unions);
  const nodes = included.filter((p) => pos[p.id]);
  if (!nodes.length) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="100%"></svg>';
  }

  const segs = segments(record.unions, pos);
  const xs = nodes.map((p) => pos[p.id].x);
  const ys = nodes.map((p) => pos[p.id].cy);
  const minX = Math.min(...xs) - 52;
  const maxX = Math.max(...xs) + 52;
  const minY = Math.min(...ys) - 34;
  const maxY = Math.max(...ys) + 54;
  const w = maxX - minX;
  const h = maxY - minY;

  let body = '';
  for (const s of segs) {
    body += `<line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" stroke="${LINE}" stroke-width="1.3"/>`;
  }
  for (const p of nodes) {
    body += glyph(p, pos[p.id], catalog, palette, record.probandId);
  }

  const defs =
    '<defs><marker id="ar" markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto">' +
    `<path d="M0,0 L6,3 L0,6 Z" fill="${OUTLINE}"/></marker></defs>`;

  return (
    `<svg viewBox="${minX} ${minY} ${w} ${h}" width="100%" preserveAspectRatio="xMidYMid meet" ` +
    `xmlns="http://www.w3.org/2000/svg" style="max-height:560px">${defs}${body}</svg>`
  );
}

/** One person's glyph: shape from gender, fill from condition category, plus overlays. */
function glyph(
  p: Person,
  node: LayoutNode,
  catalog: Catalog,
  palette: Palette,
  probandId: string,
): string {
  const cx = node.x;
  const cy = node.cy;
  const g = genderOf(p);
  const conds = condIds(p);
  const fill =
    conds.length > 0 ? categoryColor(catalog.get(conds[0]).cat, palette) : UNAFFECTED_FILL;
  const sw = p.id === probandId ? 2.6 : 1.5;

  let out = '';
  if (g === 'woman') {
    out += `<circle cx="${cx}" cy="${cy}" r="${NODE}" fill="${fill}" stroke="${OUTLINE}" stroke-width="${sw}"/>`;
  } else if (g === 'nb') {
    out +=
      `<rect x="${cx - NODE}" y="${cy - NODE}" width="${2 * NODE}" height="${2 * NODE}" ` +
      `transform="rotate(45 ${cx} ${cy})" fill="${fill}" stroke="${OUTLINE}" stroke-width="${sw}"/>`;
  } else {
    out +=
      `<rect x="${cx - NODE}" y="${cy - NODE}" width="${2 * NODE}" height="${2 * NODE}" ` +
      `fill="${fill}" stroke="${OUTLINE}" stroke-width="${sw}"/>`;
  }

  if (conds.length > 1) {
    out +=
      `<circle cx="${cx + NODE - 2}" cy="${cy - NODE + 2}" r="6" fill="#111"/>` +
      `<text x="${cx + NODE - 2}" y="${cy - NODE + 2}" font-size="8" fill="#fff" text-anchor="middle" ` +
      `dominant-baseline="central" font-family="monospace">${conds.length}</text>`;
  }
  if (p.dead) {
    out +=
      `<line x1="${cx - NODE - 5}" y1="${cy + NODE + 5}" x2="${cx + NODE + 5}" y2="${cy - NODE - 5}" ` +
      `stroke="${OUTLINE}" stroke-width="1.6"/>`;
  }
  if (p.id === probandId) {
    out +=
      `<path d="M ${cx - NODE - 18} ${cy + NODE + 14} L ${cx - NODE - 3} ${cy + NODE - 1}" ` +
      `stroke="${OUTLINE}" stroke-width="1.5" fill="none" marker-end="url(#ar)"/>`;
  }

  const sab = sabOf(p);
  const sabDiff = (g === 'man' && sab !== 'm') || (g === 'woman' && sab !== 'f') || g === 'nb';
  const years = p.dead ? `${p.birth ?? ''}–${p.death ?? ''}` : `b.${p.birth ?? ''}`;
  out +=
    `<text x="${cx}" y="${cy + NODE + 15}" font-size="10.5" fill="#111" text-anchor="middle" ` +
    `font-family="sans-serif" font-weight="600">${esc(p.name)}</text>`;
  out +=
    `<text x="${cx}" y="${cy + NODE + 27}" font-size="8" fill="#777" text-anchor="middle" ` +
    // esc() the years like p.name above: birth/death are normally numbers, but a restored
    // backup could smuggle a string here, and this text is injected via innerHTML downstream.
    `font-family="monospace">${esc(years)}${sabDiff ? `  ${sabLabel(sab)}` : ''}</text>`;
  return out;
}
