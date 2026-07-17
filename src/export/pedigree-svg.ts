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
import { H_GAP, computeLayout, offsetParallel, segments } from '@/domain/graph';

export interface PedigreeSvgOptions {
  palette?: Palette;
}

const NODE = 15;
const OUTLINE = '#1a1f28';
const LINE = '#3a4150';
const UNAFFECTED_FILL = '#ffffff';
// Perpendicular separation of a consanguineous union's doubled relationship line, in the
// same coordinate space as the layout (NODE radius 15, H_GAP 96) — ~3.5px reads as two
// distinct parallel lines at this node scale without the tracks touching.
const CONSANG_GAP = 3.5;
// Per-line character budget for a wrapped person-name label. Derived from the row spacing:
// at the 600-weight 10.5px sans-serif this label uses, an average glyph advances ~6.5px, so
// H_GAP (96px centre-to-centre) fits ⌊96 / 6.5⌋ ≈ 14 chars before a name would overrun into
// a neighbouring node. Pure/DOM-free — the serializer never measures text, so this budget is
// the deterministic stand-in for measureText and must track H_GAP.
const LABEL_BUDGET = Math.floor(H_GAP / 6.5);

/**
 * Fit a name to at most two lines within `budget` chars each, without measuring text.
 * Greedily packs whitespace-split words onto line 1 up to `budget`, the remainder onto
 * line 2. A first word that alone exceeds `budget` (or a too-long line-2 tail) is truncated
 * to `budget - 1` chars plus an ellipsis. A name that fits stays a single line. Truncation
 * slices via `Array.from` so a surrogate pair isn't split mid-unit the way `slice` would.
 */
function fitNameLines(name: string, budget: number): string[] {
  // Truncate a raw token to `budget` visible chars (ellipsis included). `Array.from` iterates
  // by codepoint, so an astral char (surrogate pair) is never split mid-unit — unlike `slice`,
  // which counts UTF-16 units. (This is codepoint-safe, not grapheme-cluster-safe: a base
  // letter + a separate combining mark can still land on different lines; both fragments stay
  // valid XML text, so it's only a cosmetically odd cut, never malformed SVG.)
  const trunc = (s: string): string =>
    Array.from(s)
      .slice(0, budget - 1)
      .join('') + '…';
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];

  // Greedily pack words onto line 1 up to the budget.
  let line1 = '';
  let i = 0;
  while (i < words.length) {
    const next = line1 ? `${line1} ${words[i]}` : words[i];
    if (next.length > budget) break;
    line1 = next;
    i++;
  }

  // The first word alone overruns the budget: line 1 is that word, truncated.
  if (i === 0) {
    line1 = trunc(words[0]);
    i = 1;
  }

  // Everything fit on line 1 (or was the single truncated word).
  if (i >= words.length) return [line1];

  // Remainder onto line 2, truncated if it still overruns (long tail or long 2nd word).
  const rest = words.slice(i).join(' ');
  const line2 = rest.length > budget ? trunc(rest) : rest;
  return [line1, line2];
}

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
  // Fit each name once and reuse for both the viewBox and the glyph, so `fitNameLines` runs
  // a single time per node.
  const fitLines = new Map(nodes.map((p) => [p.id, fitNameLines(p.name, LABEL_BUDGET)] as const));
  const minX = Math.min(...xs) - 52;
  const maxX = Math.max(...xs) + 52;
  const minY = Math.min(...ys) - 34;
  // Bottom padding is label-aware, not a fixed literal keyed off node `cy`: a wrapped
  // BOTTOM-row name adds a second 12px line, so pad to each node's actual label bottom
  // (name baseline `cy+NODE+15`, years line `+12`, wrap `+12`, descender clearance `+12`).
  // For an unwrapped node this equals the old `cy + 54` (15+27+0+12), keeping unwrapped
  // output byte-stable; a wrapped bottom node gets `cy + 66`.
  const maxY = Math.max(
    ...nodes.map(
      (p) => pos[p.id].cy + NODE + 27 + (fitLines.get(p.id)!.length === 2 ? 12 : 0) + 12,
    ),
  );
  const w = maxX - minX;
  const h = maxY - minY;

  const line = (s: { x1: number; y1: number; x2: number; y2: number }): string =>
    `<line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" stroke="${LINE}" stroke-width="1.3"/>`;
  let body = '';
  for (const s of segs) {
    // A consanguineous relationship line draws as two parallel tracks; every other segment
    // (sibship, descent, jog, and the twin diagonals/bar already emitted by `segments`) is an
    // ordinary single line.
    if (s.double) {
      const [a, b] = offsetParallel(s, CONSANG_GAP);
      body += line(a) + line(b);
    } else {
      body += line(s);
    }
  }
  for (const p of nodes) {
    body += glyph(p, pos[p.id], catalog, palette, record.probandId, fitLines.get(p.id)!);
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
  nameLines: string[],
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
  // Name label, char-budget wrapped to at most two lines so a long name can't overrun into a
  // neighbouring node (there is no DOM measureText in this pure serializer). The full,
  // untruncated name rides along as a `<title>` — the on-screen SVG tooltip and an escape
  // hatch for tests/readers to recover the original. Each visible line is esc()'d on its own.
  const [line1, line2] = nameLines;
  out +=
    `<text x="${cx}" y="${cy + NODE + 15}" font-size="10.5" fill="#111" text-anchor="middle" ` +
    `font-family="sans-serif" font-weight="600">` +
    `<title>${esc(p.name)}</title>` +
    `<tspan x="${cx}" dy="0">${esc(line1)}</tspan>` +
    (line2 !== undefined ? `<tspan x="${cx}" dy="12">${esc(line2)}</tspan>` : '') +
    `</text>`;
  // Years/sab line drops by one line-height only when the name wrapped, so it clears the
  // second name line; unchanged (cy+NODE+27) for a single-line name.
  const yearsY = cy + NODE + 27 + (line2 !== undefined ? 12 : 0);
  out +=
    // fill="#666" (~5.7:1 on white) clears WCAG AA 4.5:1 for this 8px byline; #777 (~4.48:1)
    // fell just short.
    `<text x="${cx}" y="${yearsY}" font-size="8" fill="#666" text-anchor="middle" ` +
    // esc() the years like p.name above: birth/death are normally numbers, but a restored
    // backup could smuggle a string here, and this text is injected via innerHTML downstream.
    `font-family="monospace">${esc(years)}${sabDiff ? `  ${sabLabel(sab)}` : ''}</text>`;
  return out;
}
