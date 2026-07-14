// Generate src/data/conditions.ts from the self-contained base catalog
// (scripts/conditions.source.json), enriched with verified SNOMED CT and ICD-10-CM codes.
// This owns its source, so prototype/ can be pruned without breaking the build.
import { readFileSync, writeFileSync } from 'node:fs';

const conditions = JSON.parse(readFileSync('scripts/conditions.source.json', 'utf8'));
if (!Array.isArray(conditions)) throw new Error('catalog source not found');

const SNOMED = {
  brca: '254837009',
  colon: '363406005',
  prostate: '399068003',
  ovarian: '363443007',
  lung: '93880001',
  endometrial: '315267003',
  gastric: '363349007',
  panc: '372003004',
  melanoma: '2092003',
  t2d: '44054006',
  t1d: '46635009',
  chol: '13644009',
  cad: '53741008',
  htn: '38341003',
  stroke: '230690007',
  afib: '49436004',
  thy: '40930008',
  dep: '35489007',
  anx: '48694002',
  alz: '26929004',
  asthma: '195967001',
  celiac: '396331005',
  oa: '396275006',
};

// ICD-10-CM codes verified against the FY2026 set via the ICD-10 MCP tool.
const ICD10 = {
  brca: 'C50.919',
  colon: 'C18.9',
  ovarian: 'C56.9',
  endometrial: 'C54.9',
  gastric: 'C16.9',
  prostate: 'C61',
  lung: 'C34.90',
  panc: 'C25.9',
  melanoma: 'C43.9',
  cad: 'I25.10',
  chol: 'E78.5',
  htn: 'I10',
  stroke: 'I63.9',
  afib: 'I48.91',
  t2d: 'E11.9',
  t1d: 'E10.9',
  thy: 'E03.9',
  alz: 'G30.9',
  dep: 'F32.9',
  anx: 'F41.9',
  asthma: 'J45.909',
  celiac: 'K90.0',
  oa: 'M19.90',
};

const enriched = conditions.map((c) => {
  const out = { id: c.id, name: c.name, cat: c.cat, base: c.base, pattern: c.pattern };
  if (c.syn && c.syn.length) out.syn = c.syn;
  if (ICD10[c.id]) out.icd10 = ICD10[c.id];
  if (SNOMED[c.id]) out.snomed = SNOMED[c.id];
  return out;
});

const COMMON = [
  'htn',
  't2d',
  'chol',
  'cad',
  'dep',
  'anx',
  'asthma',
  'thy',
  'oa',
  'brca',
  'colon',
  'alz',
];

const fmt = (c) => {
  const parts = [
    `id: ${JSON.stringify(c.id)}`,
    `name: ${JSON.stringify(c.name)}`,
    `cat: ${JSON.stringify(c.cat)}`,
    `base: ${c.base}`,
    `pattern: ${JSON.stringify(c.pattern)}`,
  ];
  if (c.syn) parts.push(`syn: ${JSON.stringify(c.syn)}`);
  if (c.icd10) parts.push(`icd10: ${JSON.stringify(c.icd10)}`);
  if (c.snomed) parts.push(`snomed: ${JSON.stringify(c.snomed)}`);
  return `  { ${parts.join(', ')} },`;
};

const icdCount = enriched.filter((c) => c.icd10).length;
const header = `/**
 * Curated condition catalog — the "conditions the engine understands".
 *
 * This is a STARTING POINT, not the ceiling: it carries the value-add metadata the
 * pattern/screening logic reasons on (category, inheritance pattern, rough prevalence,
 * synonyms) plus baked-in codes for the high-signal subset. The long tail of ICD-10-CM
 * (~74,000 codes) is reached at runtime through the vocabulary adapter
 * (\`src/integrations/vocabulary.ts\`), so the app is never limited to this list.
 *
 * DO NOT EDIT BY HAND — regenerate with \`npm run gen:conditions\`, which re-derives it
 * from \`scripts/conditions.source.json\` and the verified code maps. See \`docs/ARCHITECTURE.md\`.
 *
 * Prevalences are illustrative (roadmap §3 tracks binding them to sourced epidemiology).
 * ICD-10-CM codes verified against FY2026; SNOMED CT concept ids are representative.
 * ${enriched.length} conditions, ${icdCount} with ICD-10-CM codes.
 */
import type { CategoryKey, Condition } from '@/domain/types';

export const CONDITIONS: readonly Condition[] = [
`;

const body = enriched.map(fmt).join('\n');
const footer = `
];

/** Ids shown, in order, when the condition search box is empty. */
export const COMMON_CONDITIONS: readonly string[] = ${JSON.stringify(COMMON)};

/** Assert the catalog only uses known category keys at module load. */
const CATEGORY_KEYS: ReadonlySet<CategoryKey> = new Set([
  'card', 'canc', 'endo', 'neuro', 'ment', 'auto', 'resp', 'gi', 'renal', 'musc', 'blood', 'sens', 'repro', 'other',
]);
for (const c of CONDITIONS) {
  if (!CATEGORY_KEYS.has(c.cat)) throw new Error(\`Unknown category \${c.cat} on \${c.id}\`);
}
`;

writeFileSync('src/data/conditions.ts', header + body + footer + '\n');
console.log(
  `Wrote src/data/conditions.ts — ${enriched.length} conditions, ${icdCount} ICD-10 coded.`,
);
