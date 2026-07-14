// Generate src/data/conditions.ts from the self-contained base catalog
// (scripts/conditions.source.json), enriched with verified SNOMED CT / ICD-10-CM / HPO
// codes and sourced epidemiology (prevalence + heritability, with provenance).
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
  // Broadened coverage (Phase 1) — verified SNOMED CT concept ids.
  hf: '84114007',
  aaa: '233985008',
  cardiomyo: '85898001',
  longqt: '9651007',
  vte: '429098002',
  pad: '399957001',
  thyroidca: '363478007',
  kidneyca: '702391001',
  bladderca: '399326009',
  leukemia: '93143009',
  lymphoma: '118601006',
  cervical: '363354003',
  liverca: '109841003',
  utuc: '363457009',
  hyperthy: '34486009',
  obesity: '414916001',
  gout: '90560007',
  pcos: '237055002',
  osteoporosis: '64859006',
  hemochrom: '35400008',
  park: '49049000',
  epilepsy: '84757009',
  migraine: '37796009',
  ms: '24700007',
  als: '86044005',
  hunt: '58756001',
  bipolar: '13746004',
  schizo: '58214004',
  ocd: '191736004',
  adhd: '406506008',
  autism: '408856003',
  ra: '69896004',
  lupus: '55464009',
  psoriasis: '9014002',
  crohn: '34000006',
  uc: '64766004',
  copd: '13645005',
  cf: '190905008',
  osa: '78275009',
  gerd: '235595009',
  ibs: '10743008',
  ckd: '709044004',
  pkd: '765330003',
  sickle: '127040003',
  hemophilia: '90935002',
  factorv: '307091009',
  glaucoma: '23986001',
  amd: '267718000',
  endometriosis: '129103003',
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
  // Broadened coverage (Phase 1) — verified against ICD-10-CM FY2026.
  hf: 'I50.9',
  aaa: 'I71.40',
  vte: 'I82.90',
  cardiomyo: 'I42.9',
  longqt: 'I45.81',
  pad: 'I73.9',
  thyroidca: 'C73',
  kidneyca: 'C64.9',
  bladderca: 'C67.9',
  leukemia: 'C95.90',
  lymphoma: 'C85.90',
  cervical: 'C53.9',
  liverca: 'C22.0',
  // C65.9 = renal pelvis; a ureteral primary codes to C66.9 (ICD-10-CM has no single
  // upper-tract code). One representative code; the name/synonyms carry both sites.
  utuc: 'C65.9',
  hyperthy: 'E05.90',
  obesity: 'E66.9',
  gout: 'M10.9',
  pcos: 'E28.2',
  osteoporosis: 'M81.0',
  hemochrom: 'E83.110',
  park: 'G20.A1',
  epilepsy: 'G40.909',
  migraine: 'G43.909',
  ms: 'G35.D',
  als: 'G12.21',
  hunt: 'G10',
  bipolar: 'F31.9',
  schizo: 'F20.9',
  ocd: 'F42.9',
  adhd: 'F90.9',
  autism: 'F84.0',
  ra: 'M06.9',
  lupus: 'M32.9',
  psoriasis: 'L40.9',
  crohn: 'K50.90',
  uc: 'K51.90',
  copd: 'J44.9',
  cf: 'E84.9',
  osa: 'G47.33',
  gerd: 'K21.9',
  ibs: 'K58.9',
  ckd: 'N18.9',
  pkd: 'Q61.3',
  sickle: 'D57.1',
  hemophilia: 'D66',
  factorv: 'D68.51',
  glaucoma: 'H40.9',
  amd: 'H35.30',
  endometriosis: 'N80.9',
};

// Human Phenotype Ontology terms (open / redistributable) for the genetics audience —
// the native vocabulary of the Phenopacket export. Stored with the `HP:` prefix.
const HPO = {
  brca: 'HP:0100013',
  colon: 'HP:0003003',
  prostate: 'HP:0012125',
  ovarian: 'HP:0100615',
  panc: 'HP:0002894',
  melanoma: 'HP:0002861',
  gastric: 'HP:0006753',
  endometrial: 'HP:0012114',
  t1d: 'HP:0100651',
  t2d: 'HP:0005978',
  thy: 'HP:0000821',
  alz: 'HP:0002511',
  park: 'HP:0001300',
  epilepsy: 'HP:0001250',
  hunt: 'HP:0002072',
  als: 'HP:0007354',
  cardiomyo: 'HP:0001638',
  longqt: 'HP:0001657',
  pkd: 'HP:0000113',
  hemochrom: 'HP:0011031',
  cf: 'HP:0012236',
  sickle: 'HP:0045047',
  // thalassemia intentionally omitted: HPO has no thalassemia disease term, and the
  // nearest finding (HbF persistence) is more specific to HPFH — better absent than wrong.
  hemophilia: 'HP:0003125',
  g6pd: 'HP:0034060',
  factorv: 'HP:0012175',
  md: 'HP:0003560',
  ehlers: 'HP:0001382',
  colorblind: 'HP:0000551',
  retinitis: 'HP:0000510',
  ra: 'HP:0001370',
  celiac: 'HP:0002608',
  crohn: 'HP:0100280',
};

// Sourced epidemiology (roadmap §3): `base` prevalence (%) bound to published
// surveillance data with a short citation (`prevSource`), plus a heritability estimate
// (`herit`, 0–1) with its own citation where a defensible twin/registry figure exists.
// A `base` here overrides the illustrative value in conditions.source.json. Heritability
// is a population statistic, never a personal-risk number — see CLAUDE.md guardrail #1.
// Grounded via the medical-domain-expert (PubMed/CDC/SEER/NHANES/AHA); estimate-grade
// heritabilities are marked "est." Numbers are general-population US figures.
const EPIDEMIOLOGY = {
  cad: {
    base: 6,
    prevSource: 'AHA Statistics 2024 (~5% adults)',
    herit: 0.4,
    heritSource: 'twin studies (est.)',
  },
  htn: {
    base: 47,
    prevSource: 'CDC/NHANES (2017 ACC/AHA def.)',
    herit: 0.4,
    heritSource: 'twin/family BP (est.)',
  },
  chol: {
    base: 38,
    prevSource: 'CDC/NHANES (dyslipidemia)',
    herit: 0.5,
    heritSource: 'twin LDL (est.)',
  },
  stroke: {
    base: 3,
    prevSource: 'AHA Statistics (point prev.)',
    herit: 0.3,
    heritSource: 'twin (est.)',
  },
  afib: {
    base: 2,
    prevSource: 'AHA/CDC (~2% adults; lifetime ~1 in 3)',
    herit: 0.22,
    heritSource: 'Framingham (est.)',
  },
  hf: { base: 2, prevSource: 'AHA/CDC (~2% adults; lifetime ~1 in 4)' },
  brca: {
    base: 13,
    prevSource: 'SEER lifetime risk (women)',
    herit: 0.31,
    heritSource: 'Mucci 2016 JAMA (PMID 26746459)',
  },
  colon: {
    base: 4.1,
    prevSource: 'SEER lifetime risk',
    herit: 0.35,
    heritSource: 'Lichtenstein 2000 (est.)',
  },
  prostate: {
    base: 12.5,
    prevSource: 'SEER lifetime risk (men)',
    herit: 0.57,
    heritSource: 'Mucci 2016 JAMA (PMID 26746459)',
  },
  lung: {
    base: 6,
    prevSource: 'SEER lifetime risk',
    herit: 0.08,
    heritSource: 'Mucci 2016 (smoking-dominant; est.)',
  },
  ovarian: {
    base: 1.1,
    prevSource: 'SEER lifetime risk (women)',
    herit: 0.39,
    heritSource: 'Mucci 2016 JAMA (PMID 26746459)',
  },
  panc: { base: 1.7, prevSource: 'SEER lifetime risk' },
  melanoma: {
    base: 2.3,
    prevSource: 'SEER lifetime risk',
    herit: 0.58,
    heritSource: 'Mucci 2016 JAMA (PMID 26746459)',
  },
  gastric: { base: 0.8, prevSource: 'SEER lifetime risk' },
  endometrial: {
    base: 3.1,
    prevSource: 'SEER lifetime risk (corpus uteri)',
    herit: 0.27,
    heritSource: 'Mucci 2016 JAMA (PMID 26746459)',
  },
  utuc: { base: 0.1, prevSource: 'SEER (renal pelvis/ureter; rare)' },
  t2d: {
    base: 11,
    prevSource: 'CDC Natl Diabetes Stats 2022',
    herit: 0.72,
    heritSource: 'twin, Kaprio 1992 (est.)',
  },
  t1d: { base: 0.4, prevSource: 'CDC', herit: 0.88, heritSource: 'twin, Kaprio 1992 (est.)' },
  thy: {
    base: 5,
    prevSource: 'NHANES (subclinical + overt)',
    herit: 0.65,
    heritSource: 'AITD twin (est.)',
  },
  obesity: {
    base: 42,
    prevSource: 'CDC NHANES 2017–2020',
    herit: 0.6,
    heritSource: 'twin BMI, Elks 2012 (est.)',
  },
  hemochrom: { base: 0.4, prevSource: 'HFE C282Y homozygote freq. (NH white)' },
  alz: {
    base: 11,
    prevSource: "Alzheimer's Assoc. 2024 (of age ≥65)",
    herit: 0.7,
    heritSource: 'Gatz 2006 (PMID 16461860)',
  },
  park: {
    base: 1,
    prevSource: 'GBD / Marras 2018 (of age ≥60)',
    herit: 0.3,
    heritSource: 'twin, Wirdefeldt (est.)',
  },
  ms: {
    base: 0.3,
    prevSource: 'Wallin 2019 Neurology (US)',
    herit: 0.5,
    heritSource: 'twin (est.)',
  },
  hunt: { base: 0.01, prevSource: 'European-ancestry ~10–14 / 100k' },
  dep: {
    base: 20,
    prevSource: 'NCS-R / NSDUH (lifetime MDD)',
    herit: 0.37,
    heritSource: 'Sullivan 2000 meta (est.)',
  },
  anx: {
    base: 19,
    prevSource: 'NCS-R / NIMH (past-year)',
    herit: 0.3,
    heritSource: 'Hettema 2001 meta (est.)',
  },
  bipolar: {
    base: 2.8,
    prevSource: 'NCS-R (lifetime)',
    herit: 0.75,
    heritSource: 'twin, McGuffin 2003 (est.)',
  },
  schizo: {
    base: 0.7,
    prevSource: 'McGrath 2008 (lifetime)',
    herit: 0.79,
    heritSource: 'Hilker 2018 Biol Psychiatry (PMID 28987712)',
  },
  adhd: {
    base: 8,
    prevSource: 'CDC (children); Polanczyk pooled ~5%',
    herit: 0.74,
    heritSource: 'Faraone & Larsson 2019 (PMID 29892054)',
  },
  autism: {
    base: 2.8,
    prevSource: 'CDC ADDM 2020 (~1 in 36)',
    herit: 0.8,
    heritSource: 'Tick 2016 (PMID 26709141)',
  },
  ra: {
    base: 0.6,
    prevSource: 'CDC / Framingham',
    herit: 0.6,
    heritSource: 'MacGregor 2000 twin (est.)',
  },
  celiac: {
    base: 0.7,
    prevSource: 'Rubio-Tapia 2012 (US)',
    herit: 0.75,
    heritSource: 'twin, Nisticò 2006 (est.)',
  },
  crohn: { base: 0.3, prevSource: 'CDC / Dahlhamer 2016', herit: 0.5, heritSource: 'twin (est.)' },
  asthma: {
    base: 8,
    prevSource: 'CDC NHIS (current asthma)',
    herit: 0.6,
    heritSource: 'twin, Thomsen 2010 (est.)',
  },
  copd: { base: 6, prevSource: 'CDC BRFSS', herit: 0.4, heritSource: 'twin lung-function (est.)' },
  ckd: { base: 14, prevSource: 'CDC CKD Surveillance / USRDS' },
  oa: {
    base: 22,
    prevSource: 'CDC (arthritis; OA subset)',
    herit: 0.5,
    heritSource: 'twin, site-specific (est.)',
  },
  osteoporosis: {
    base: 13,
    prevSource: 'NHANES 2017–18 (age ≥50)',
    herit: 0.6,
    heritSource: 'twin BMD (est.)',
  },
  cf: { base: 0.03, prevSource: 'CF Foundation Registry' },
  sickle: { base: 0.03, prevSource: 'CDC (~1 in 365 Black births; ancestry-specific)' },
  pkd: { base: 0.1, prevSource: 'ADPKD ~1 in 1,000 (Willey 2017)' },
  cardiomyo: { base: 0.4, prevSource: 'HCM ~1 in 500; DCM ~1 in 250–500' },
  factorv: { base: 5, prevSource: '~3–8% European ancestry (heterozygous)' },
};

const enriched = conditions.map((c) => {
  const epi = EPIDEMIOLOGY[c.id];
  const out = {
    id: c.id,
    name: c.name,
    cat: c.cat,
    base: epi && epi.base != null ? epi.base : c.base,
    pattern: c.pattern,
  };
  if (epi?.prevSource) out.prevSource = epi.prevSource;
  if (epi?.herit != null) out.herit = epi.herit;
  if (epi?.heritSource) out.heritSource = epi.heritSource;
  if (c.syn && c.syn.length) out.syn = c.syn;
  if (ICD10[c.id]) out.icd10 = ICD10[c.id];
  if (SNOMED[c.id]) out.snomed = SNOMED[c.id];
  if (HPO[c.id]) out.hpo = HPO[c.id];
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
  ];
  if (c.prevSource) parts.push(`prevSource: ${JSON.stringify(c.prevSource)}`);
  if (c.herit != null) parts.push(`herit: ${c.herit}`);
  if (c.heritSource) parts.push(`heritSource: ${JSON.stringify(c.heritSource)}`);
  parts.push(`pattern: ${JSON.stringify(c.pattern)}`);
  if (c.syn) parts.push(`syn: ${JSON.stringify(c.syn)}`);
  if (c.icd10) parts.push(`icd10: ${JSON.stringify(c.icd10)}`);
  if (c.snomed) parts.push(`snomed: ${JSON.stringify(c.snomed)}`);
  if (c.hpo) parts.push(`hpo: ${JSON.stringify(c.hpo)}`);
  return `  { ${parts.join(', ')} },`;
};

const icdCount = enriched.filter((c) => c.icd10).length;
const snomedCount = enriched.filter((c) => c.snomed).length;
const hpoCount = enriched.filter((c) => c.hpo).length;
const sourcedCount = enriched.filter((c) => c.prevSource).length;
const header = `/**
 * Curated condition catalog — the "conditions the engine understands".
 *
 * This is a STARTING POINT, not the ceiling: it carries the value-add metadata the
 * pattern/screening logic reasons on (category, inheritance pattern, prevalence,
 * synonyms) plus baked-in codes for the high-signal subset. The long tail of ICD-10-CM
 * (~74,000 codes) is reached at runtime through the vocabulary adapter
 * (\`src/integrations/vocabulary.ts\`), so the app is never limited to this list.
 *
 * DO NOT EDIT BY HAND — regenerate with \`npm run gen:conditions\`, which re-derives it
 * from \`scripts/conditions.source.json\` and the verified code + epidemiology maps. See
 * \`docs/ARCHITECTURE.md\`.
 *
 * Prevalence is bound to sourced epidemiology (CDC / SEER / NHANES / AHA, etc.) where a
 * \`prevSource\` is present (roadmap §3); the rest remain illustrative starting values.
 * Heritability (\`herit\`) is a cited population statistic, never a personal-risk number.
 * ICD-10-CM codes verified against FY2026; SNOMED CT and HPO ids are representative.
 * ${enriched.length} conditions — ${icdCount} ICD-10-CM, ${snomedCount} SNOMED CT, ${hpoCount} HPO, ${sourcedCount} sourced-prevalence.
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
  `Wrote src/data/conditions.ts — ${enriched.length} conditions, ${icdCount} ICD-10, ${snomedCount} SNOMED, ${hpoCount} HPO, ${sourcedCount} sourced.`,
);
