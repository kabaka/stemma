/**
 * Conformance tests for the GA4GH Phenopacket v2 export (roadmap §1 — "Test the export
 * layer against validators / Phenopacket schema").
 *
 * As with the FHIR conformance suite, Stemma is offline-first and ships no heavy schema
 * engine, so this encodes the normative Phenopacket v2 structural rules for what the
 * exporter emits as a self-contained validator, `validatePhenopacket`, then asserts a
 * real export passes and that the validator rejects injected violations. Rules derived
 * from the GA4GH Phenopacket Schema v2 (phenopacket-schema.readthedocs.io):
 *   - Phenopacket / MetaData / Resource, Individual, PhenotypicFeature, OntologyClass,
 *     TimeElement (Age.iso8601duration), VitalStatus, and Pedigree / Person.
 *
 * Beyond shape, it checks two integrity rules a downstream tool relies on: every
 * OntologyClass CURIE prefix resolves to a declared metaData Resource, and every
 * pedigree parent id is either "0" (founder) or another individual in the pedigree.
 */
import { describe, it, expect } from 'vitest';
import { buildPhenopacket } from './phenopacket';
import type { Phenopacket, PhenopacketMember } from './phenopacket';
import { seedRecord } from '@/data/seed';
import { buildCatalog } from '@/domain/catalog';

const NOW = '2026-07-14T12:00:00.000Z';
const catalog = buildCatalog([]);
const OPTS = { now: NOW, id: 'stemma-family-test', asOfYear: 2026 };
const build = (): Phenopacket => buildPhenopacket(seedRecord(), catalog, OPTS);

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
// ISO-8601 duration with at least one component (Age.iso8601duration).
const ISO_DURATION = /^P(?!$)(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+S)?)?$/;
const CURIE = /^[A-Za-z][\w.-]*:.+$/;
const SEX = new Set(['MALE', 'FEMALE', 'UNKNOWN_SEX', 'OTHER_SEX']);
const VITAL = new Set(['ALIVE', 'DECEASED', 'UNKNOWN_STATUS']);
const AFFECTED = new Set(['AFFECTED', 'UNAFFECTED', 'MISSING']);
const nonEmpty = (s: unknown): boolean => typeof s === 'string' && s.length > 0;

function checkTimeElement(te: unknown, path: string, errs: string[]): void {
  if (te == null) return;
  const dur = (te as { age?: { iso8601duration?: string } }).age?.iso8601duration;
  if (!dur || !ISO_DURATION.test(dur))
    errs.push(`${path}.age.iso8601duration "${dur}" is not an ISO-8601 duration`);
}

function checkMember(
  m: PhenopacketMember,
  path: string,
  prefixes: Set<string>,
  errs: string[],
): void {
  const s = m.subject;
  if (!nonEmpty(s?.id)) errs.push(`${path}.subject.id is required`);
  if (!SEX.has(s?.sex)) errs.push(`${path}.subject.sex "${s?.sex}" not in the sex value set`);
  if (s?.vitalStatus && !VITAL.has(s.vitalStatus.status))
    errs.push(`${path}.subject.vitalStatus.status "${s.vitalStatus.status}" invalid`);
  checkTimeElement(s?.timeAtLastEncounter, `${path}.subject.timeAtLastEncounter`, errs);
  if (!Array.isArray(m.phenotypicFeatures)) {
    errs.push(`${path}.phenotypicFeatures must be an array`);
    return;
  }
  m.phenotypicFeatures.forEach((f, i) => {
    const fp = `${path}.phenotypicFeatures[${i}]`;
    if (!nonEmpty(f.type?.id) || !CURIE.test(f.type.id))
      errs.push(`${fp}.type.id "${f.type?.id}" is not a CURIE`);
    else if (!prefixes.has(f.type.id.split(':')[0]))
      errs.push(`${fp}.type.id prefix has no declared metaData Resource`);
    if (!nonEmpty(f.type?.label)) errs.push(`${fp}.type.label is required`);
    checkTimeElement(f.onset, `${fp}.onset`, errs);
  });
}

/** Return a list of Phenopacket v2 conformance errors; empty means valid. */
export function validatePhenopacket(pp: Phenopacket): string[] {
  const errs: string[] = [];
  if (!nonEmpty(pp.id)) errs.push('Phenopacket.id is required');

  const md = pp.metaData;
  if (!md) {
    errs.push('Phenopacket.metaData is required');
    return errs;
  }
  if (!TIMESTAMP.test(md.created)) errs.push('metaData.created is not an RFC3339 timestamp');
  if (!nonEmpty(md.createdBy)) errs.push('metaData.createdBy is required');
  if (md.phenopacketSchemaVersion !== '2.0')
    errs.push(`metaData.phenopacketSchemaVersion "${md.phenopacketSchemaVersion}" must be "2.0"`);
  const prefixes = new Set<string>();
  if (!Array.isArray(md.resources) || md.resources.length === 0)
    errs.push('metaData.resources must list at least one Resource');
  for (const [i, r] of (md.resources ?? []).entries()) {
    for (const field of ['id', 'name', 'url', 'namespacePrefix', 'iriPrefix'] as const)
      if (!nonEmpty(r[field])) errs.push(`metaData.resources[${i}].${field} is required`);
    if (nonEmpty(r.namespacePrefix)) prefixes.add(r.namespacePrefix);
  }

  checkMember(pp.proband, 'proband', prefixes, errs);
  if (!Array.isArray(pp.relatives)) errs.push('Phenopacket.relatives must be an array');
  (pp.relatives ?? []).forEach((r, i) => checkMember(r, `relatives[${i}]`, prefixes, errs));

  const persons = pp.pedigree?.persons;
  if (!Array.isArray(persons) || persons.length === 0) {
    errs.push('pedigree.persons must be a non-empty array');
    return errs;
  }
  const ids = new Set(persons.map((p) => p.individualId));
  persons.forEach((p, i) => {
    const pp2 = `pedigree.persons[${i}]`;
    if (!nonEmpty(p.familyId)) errs.push(`${pp2}.familyId is required`);
    if (!nonEmpty(p.individualId)) errs.push(`${pp2}.individualId is required`);
    if (!SEX.has(p.sex)) errs.push(`${pp2}.sex "${p.sex}" not in the sex value set`);
    if (!AFFECTED.has(p.affectedStatus))
      errs.push(`${pp2}.affectedStatus "${p.affectedStatus}" invalid`);
    for (const rel of ['paternalId', 'maternalId'] as const) {
      const v = p[rel];
      if (v !== '0' && !ids.has(v))
        errs.push(`${pp2}.${rel} "${v}" is neither "0" nor a known individual`);
    }
  });
  return errs;
}

describe('Phenopacket v2 conformance', () => {
  it('the seed export is conformant (no validation errors)', () => {
    expect(validatePhenopacket(build())).toEqual([]);
  });

  it('every phenotypic-feature CURIE resolves to a declared metaData Resource', () => {
    // Guards the export against emitting an ontology prefix (e.g. STEMMA:, HP:) that a
    // consuming tool cannot dereference because no Resource declares it.
    expect(validatePhenopacket(build())).toEqual([]);
  });

  // --- Negative controls: the validator must reject real violations ---

  it('rejects a wrong schema version', () => {
    const bad = build();
    bad.metaData.phenopacketSchemaVersion = '1.0';
    expect(validatePhenopacket(bad).some((e) => /schemaVersion/i.test(e))).toBe(true);
  });

  it('rejects a subject sex outside the value set', () => {
    const bad = build();
    bad.proband.subject.sex = 'female' as PhenopacketMember['subject']['sex'];
    expect(validatePhenopacket(bad).some((e) => /sex/.test(e))).toBe(true);
  });

  it('rejects a non-ISO-8601 onset duration', () => {
    const bad = build();
    bad.proband.phenotypicFeatures[0].onset = { age: { iso8601duration: '28 years' } };
    expect(validatePhenopacket(bad).some((e) => /ISO-8601/.test(e))).toBe(true);
  });

  it('rejects an OntologyClass CURIE whose prefix has no declared Resource', () => {
    const bad = build();
    bad.proband.phenotypicFeatures[0].type.id = 'MADEUP:123';
    expect(validatePhenopacket(bad).some((e) => /no declared metaData Resource/.test(e))).toBe(
      true,
    );
  });

  it('rejects a dangling pedigree parent reference', () => {
    const bad = build();
    bad.pedigree.persons[0].paternalId = 'ghost';
    expect(validatePhenopacket(bad).some((e) => /known individual/.test(e))).toBe(true);
  });

  it('rejects an unknown affectedStatus', () => {
    const bad = build();
    bad.pedigree.persons[0].affectedStatus =
      'YES' as (typeof bad.pedigree.persons)[0]['affectedStatus'];
    expect(validatePhenopacket(bad).some((e) => /affectedStatus/.test(e))).toBe(true);
  });
});
