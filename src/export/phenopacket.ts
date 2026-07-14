/**
 * GA4GH Phenopacket v2 export.
 *
 * Serialises a {@link FamilyRecord} into a Phenopacket-family document — the
 * geneticist / researcher interchange target from roadmap §4
 * (`prototype/uploads/Lineage-expansion-ideation.md`). Carries the `proband`
 * (subject + phenotypic features), affected `relatives`, a `pedigree` derived from the
 * union edges (paternal/maternal ids by sex assigned at birth), and `metaData`.
 *
 * Ported faithfully from the prototype's `buildPhenopacket`. Pure and deterministic
 * given `opts` (`now`, `id`, `asOfYear`); the default id derives from `now`.
 */
import type { Catalog } from '@/domain/catalog';
import type { FamilyRecord, Person } from '@/domain/types';
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
  created: string;
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
  /** ISO timestamp for `metaData.created` and the default id; defaults to now. */
  now?: string;
  /** Explicit document id; when omitted a deterministic id is derived from `now`. */
  id?: string;
  /** As-of year for the proband's age at last encounter. */
  asOfYear?: number;
}

/** As-of year for living-age math; overridable via {@link PhenopacketOptions.asOfYear}. */
export const AS_OF_YEAR = new Date().getFullYear();

const FAMILY_ID = 'stemma-kindred';
const SNOMED_RESOURCE: PhenopacketResource = {
  id: 'snomed',
  name: 'SNOMED CT',
  url: 'http://snomed.info/sct',
  namespacePrefix: 'SNOMED',
  iriPrefix: 'http://snomed.info/id/',
};

function phenoSex(p: Person): PhenoSex {
  const s = sabOf(p);
  return s === 'f' ? 'FEMALE' : s === 'm' ? 'MALE' : 'UNKNOWN_SEX';
}

/** Serialise a family record into a GA4GH Phenopacket v2 family document. */
export function buildPhenopacket(
  record: FamilyRecord,
  catalog: Catalog,
  opts: PhenopacketOptions = {},
): Phenopacket {
  const idx = indexPeople(record.people, record.unions);
  const asOfYear = opts.asOfYear ?? AS_OF_YEAR;
  const created = opts.now ?? new Date().toISOString();
  const probandId = record.probandId;
  const proband = personById(idx, probandId);
  if (!proband) throw new Error(`proband ${probandId} not found in record`);

  const features = (p: Person): PhenotypicFeature[] =>
    condIds(p).map((cid) => {
      const meta = catalog.get(cid);
      const e = condEntry(p, cid);
      const feature: PhenotypicFeature = {
        type: { id: meta.snomed ? `SNOMED:${meta.snomed}` : `STEMMA:${cid}`, label: meta.name },
      };
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

  return {
    id: opts.id ?? `stemma-family-${Date.parse(created)}`,
    proband: { subject, phenotypicFeatures: features(proband) },
    relatives,
    pedigree: { persons },
    metaData: {
      created,
      createdBy: 'Stemma',
      phenopacketSchemaVersion: '2.0',
      resources: [SNOMED_RESOURCE],
    },
  };
}
