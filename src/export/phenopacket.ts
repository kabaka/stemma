/**
 * GA4GH Phenopacket v2 export.
 *
 * Serialises a {@link FamilyRecord} into a Phenopacket-family document — the
 * geneticist / researcher interchange target from roadmap §4
 * (`prototype/uploads/Lineage-expansion-ideation.md`). Carries the `proband`
 * (subject + phenotypic features), affected `relatives`, a `pedigree` derived from the
 * union edges (paternal/maternal ids by sex assigned at birth), and `metaData`.
 *
 * Ported faithfully from the prototype's `buildPhenopacket`. Pure and deterministic:
 * callers inject `asOfYear` (required) plus optional `now`/`id`. `metaData.created` is
 * omitted when no `now` is supplied, and the default id derives from `now` when present.
 */
import type { Catalog } from '@/domain/catalog';
import type { Condition, FamilyRecord, Person } from '@/domain/types';
import { condEntry, condIds, sabOf } from '@/domain/person';
import { indexPeople, parentsOf, personById } from '@/domain/graph';

export type PhenoSex = 'MALE' | 'FEMALE' | 'UNKNOWN_SEX';
export type AffectedStatus = 'AFFECTED' | 'UNAFFECTED' | 'MISSING';
export type VitalStatusCode = 'ALIVE' | 'DECEASED' | 'UNKNOWN_STATUS';

export interface OntologyClass {
  id: string;
  label: string;
}
export interface Age {
  iso8601duration: string;
}
export interface TimeElement {
  age: Age;
}
export interface PhenotypicFeature {
  type: OntologyClass;
  onset?: TimeElement;
}
export interface VitalStatus {
  status: VitalStatusCode;
}
export interface Individual {
  id: string;
  sex: PhenoSex;
  vitalStatus?: VitalStatus;
  timeAtLastEncounter?: TimeElement;
}
export interface PhenopacketMember {
  subject: Individual;
  phenotypicFeatures: PhenotypicFeature[];
}
export interface PedigreePerson {
  familyId: string;
  individualId: string;
  paternalId: string;
  maternalId: string;
  sex: PhenoSex;
  affectedStatus: AffectedStatus;
}
export interface Pedigree {
  persons: PedigreePerson[];
}
export interface PhenopacketResource {
  id: string;
  name: string;
  url: string;
  namespacePrefix: string;
  iriPrefix: string;
}
export interface MetaData {
  /** ISO creation timestamp; omitted when the caller injects no `now`. */
  created?: string;
  createdBy: string;
  phenopacketSchemaVersion: string;
  resources: PhenopacketResource[];
}
export interface Phenopacket {
  id: string;
  proband: PhenopacketMember;
  relatives: PhenopacketMember[];
  pedigree: Pedigree;
  metaData: MetaData;
}

export interface PhenopacketOptions {
  /** ISO timestamp for `metaData.created` and the default id; when omitted, `created` is left off (no clock read). */
  now?: string;
  /** Explicit document id; when omitted a deterministic id is derived from `now`, or a static id when `now` is absent. */
  id?: string;
  /** As-of year for the proband's age at last encounter. Required — injected by the caller, never read from the clock. */
  asOfYear: number;
}

const FAMILY_ID = 'stemma-kindred';

/**
 * Ontology resources, keyed by CURIE prefix. SNOMED is always declared as the clinical
 * baseline; HPO (the native Phenopacket phenotype vocabulary, open/redistributable) and
 * the internal STEMMA namespace are declared only when a feature actually uses them, so
 * every emitted CURIE prefix resolves to a declared Resource. The `url` fields are
 * ontology-identity metadata written into the exported document — never fetched at runtime
 * (Stemma's only runtime network call is the optional NLM vocabulary lookup).
 */
const RESOURCE_DEFS: Record<'HP' | 'SNOMED' | 'STEMMA', PhenopacketResource> = {
  HP: {
    id: 'hp',
    name: 'Human Phenotype Ontology',
    url: 'http://purl.obolibrary.org/obo/hp.owl',
    namespacePrefix: 'HP',
    iriPrefix: 'http://purl.obolibrary.org/obo/HP_',
  },
  SNOMED: {
    id: 'snomed',
    name: 'SNOMED CT',
    url: 'http://snomed.info/sct',
    namespacePrefix: 'SNOMED',
    iriPrefix: 'http://snomed.info/id/',
  },
  STEMMA: {
    id: 'stemma',
    name: 'Stemma condition catalog',
    url: 'https://kabaka.github.io/stemma',
    namespacePrefix: 'STEMMA',
    iriPrefix: 'https://kabaka.github.io/stemma/condition/',
  },
};

function phenoSex(p: Person): PhenoSex {
  const s = sabOf(p);
  return s === 'f' ? 'FEMALE' : s === 'm' ? 'MALE' : 'UNKNOWN_SEX';
}

/** Serialise a family record into a GA4GH Phenopacket v2 family document. */
export function buildPhenopacket(
  record: FamilyRecord,
  catalog: Catalog,
  opts: PhenopacketOptions,
): Phenopacket {
  const idx = indexPeople(record.people, record.unions);
  // The as-of year and generation timestamp are injected by the caller (the sanctioned
  // wall-clock boundary), so this stays pure/deterministic. `created` is omitted from
  // metaData when no `now` is supplied, rather than reading the clock here.
  const asOfYear = opts.asOfYear;
  const created = opts.now;
  const probandId = record.probandId;
  const proband = personById(idx, probandId);
  if (!proband) throw new Error(`proband ${probandId} not found in record`);

  // Prefer HPO (the native Phenopacket phenotype vocabulary) when the catalog carries a
  // term, then SNOMED CT, then the internal STEMMA namespace — recording which prefixes
  // are used so metaData.resources declares exactly what the CURIEs reference.
  const usedPrefixes = new Set<'HP' | 'SNOMED' | 'STEMMA'>();
  const concept = (meta: Condition): OntologyClass => {
    if (meta.hpo) {
      usedPrefixes.add('HP');
      return { id: meta.hpo, label: meta.name };
    }
    if (meta.snomed) {
      usedPrefixes.add('SNOMED');
      return { id: `SNOMED:${meta.snomed}`, label: meta.name };
    }
    usedPrefixes.add('STEMMA');
    return { id: `STEMMA:${meta.id}`, label: meta.name };
  };

  const features = (p: Person): PhenotypicFeature[] =>
    condIds(p).map((cid) => {
      const e = condEntry(p, cid);
      const feature: PhenotypicFeature = { type: concept(catalog.get(cid)) };
      if (e?.onset != null) feature.onset = { age: { iso8601duration: `P${e.onset}Y` } };
      return feature;
    });

  const pedigreeParents = (id: string): { paternalId: string; maternalId: string } => {
    const parents = parentsOf(idx, id)
      .map((pid) => personById(idx, pid))
      .filter((x): x is Person => !!x);
    const father = parents.find((x) => sabOf(x) === 'm');
    const mother = parents.find((x) => sabOf(x) === 'f');
    return { paternalId: father ? father.id : '0', maternalId: mother ? mother.id : '0' };
  };

  const persons: PedigreePerson[] = record.people.map((p) => ({
    familyId: FAMILY_ID,
    individualId: p.id,
    ...pedigreeParents(p.id),
    sex: phenoSex(p),
    affectedStatus: condIds(p).length > 0 ? 'AFFECTED' : 'UNAFFECTED',
  }));

  const relatives: PhenopacketMember[] = record.people
    .filter((p) => p.id !== probandId && condIds(p).length > 0)
    .map((p) => ({
      subject: {
        id: p.id,
        sex: phenoSex(p),
        vitalStatus: { status: p.dead ? 'DECEASED' : 'ALIVE' },
      },
      phenotypicFeatures: features(p),
    }));

  const subject: Individual = { id: probandId, sex: phenoSex(proband) };
  if (proband.birth != null) {
    subject.timeAtLastEncounter = { age: { iso8601duration: `P${asOfYear - proband.birth}Y` } };
  }

  // Assemble features (populating usedPrefixes) before declaring resources. SNOMED is the
  // always-present clinical baseline; HP/STEMMA are added only when actually referenced.
  const probandFeatures = features(proband);
  const resources: PhenopacketResource[] = [RESOURCE_DEFS.SNOMED];
  if (usedPrefixes.has('HP')) resources.push(RESOURCE_DEFS.HP);
  if (usedPrefixes.has('STEMMA')) resources.push(RESOURCE_DEFS.STEMMA);

  return {
    id: opts.id ?? (created ? `stemma-family-${Date.parse(created)}` : 'stemma-family'),
    proband: { subject, phenotypicFeatures: probandFeatures },
    relatives,
    pedigree: { persons },
    metaData: {
      ...(created ? { created } : {}),
      createdBy: 'Stemma',
      phenopacketSchemaVersion: '2.0',
      resources,
    },
  };
}
