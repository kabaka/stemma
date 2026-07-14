import { describe, it, expect } from 'vitest';
import { buildFhirBundle } from './fhir';
import type {
  FhirCodeableConcept,
  FhirCondition,
  FhirFamilyMemberHistory,
  FhirPatient,
} from './fhir';
import { seedRecord } from '@/data/seed';
import { buildCatalog } from '@/domain/catalog';

const NOW = '2026-07-14T12:00:00.000Z';
const catalog = buildCatalog([]);
const build = () => buildFhirBundle(seedRecord(), catalog, { now: NOW });

describe('buildFhirBundle', () => {
  it('produces a collection Bundle carrying the given timestamp', () => {
    const bundle = build();
    expect(bundle.resourceType).toBe('Bundle');
    expect(bundle.type).toBe('collection');
    expect(bundle.timestamp).toBe(NOW);
  });

  it('emits exactly one Patient with an id, birthDate and birthsex extension', () => {
    const patients = build()
      .entry.map((e) => e.resource)
      .filter((r): r is FhirPatient => r.resourceType === 'Patient');
    expect(patients).toHaveLength(1);
    expect(patients[0].id).toBeTruthy();
    expect(patients[0].birthDate).toBe('1988');
    expect(patients[0].extension[0].valueCode).toBe('F');
  });

  it('emits a Condition per proband diagnosis, referencing the Patient', () => {
    const conditions = build()
      .entry.map((e) => e.resource)
      .filter((r): r is FhirCondition => r.resourceType === 'Condition');
    expect(conditions).toHaveLength(3);
    expect(conditions.every((c) => c.subject.reference === 'Patient/you')).toBe(true);
  });

  it('emits a FamilyMemberHistory for Robert with a relationship coding', () => {
    const fmhs = build()
      .entry.map((e) => e.resource)
      .filter((r): r is FhirFamilyMemberHistory => r.resourceType === 'FamilyMemberHistory');
    const robert = fmhs.find((f) => f.name === 'Robert');
    expect(robert).toBeDefined();
    expect(robert!.relationship.coding.length).toBeGreaterThan(0);
    expect(robert!.relationship.coding[0].code).toBe('FTH');
    expect(robert!.relationship.coding[0].system).toBe(
      'http://terminology.hl7.org/CodeSystem/v3-RoleCode',
    );
  });

  it('codes breast cancer with SNOMED CT, ICD-10-CM and the internal system', () => {
    const concepts: FhirCodeableConcept[] = [];
    for (const e of build().entry) {
      const r = e.resource;
      if (r.resourceType === 'Condition') concepts.push(r.code);
      if (r.resourceType === 'FamilyMemberHistory' && r.condition) {
        for (const c of r.condition) concepts.push(c.code);
      }
    }
    const brca = concepts.find((cc) =>
      cc.coding.some((cd) => cd.system === 'http://snomed.info/sct' && cd.code === '254837009'),
    );
    expect(brca).toBeDefined();
    expect(
      brca!.coding.some(
        (cd) => cd.system === 'http://hl7.org/fhir/sid/icd-10-cm' && cd.code === 'C50.919',
      ),
    ).toBe(true);
    expect(
      brca!.coding.some(
        (cd) => cd.system === 'https://kabaka.github.io/stemma/fhir/CodeSystem/conditions',
      ),
    ).toBe(true);
  });

  it('is deterministic given now', () => {
    expect(build()).toEqual(build());
  });

  it('excludes non-blood relatives (Alex, a spouse by marriage) from FamilyMemberHistory', () => {
    const fmhs = build()
      .entry.map((e) => e.resource)
      .filter((r): r is FhirFamilyMemberHistory => r.resourceType === 'FamilyMemberHistory');
    expect(fmhs.find((f) => f.name === 'Alex')).toBeUndefined();
  });

  it('marks a deceased relative with deceasedBoolean (Frank)', () => {
    const fmhs = build()
      .entry.map((e) => e.resource)
      .filter((r): r is FhirFamilyMemberHistory => r.resourceType === 'FamilyMemberHistory');
    const frank = fmhs.find((f) => f.name === 'Frank');
    expect(frank).toBeDefined();
    expect(frank!.deceasedBoolean).toBe(true);
  });

  it('omits the condition array for a blood relative with no recorded conditions (Rosa)', () => {
    // Carol (Tom's wife) is a by-marriage relative and is excluded entirely (see the
    // "excludes non-blood relatives" test above) — Rosa is a blood great-grandmother
    // with an empty `conds` array, so she isolates the "no conditions" branch.
    const fmhs = build()
      .entry.map((e) => e.resource)
      .filter((r): r is FhirFamilyMemberHistory => r.resourceType === 'FamilyMemberHistory');
    const rosa = fmhs.find((f) => f.name === 'Rosa');
    expect(rosa).toBeDefined();
    expect(rosa!.condition).toBeUndefined();
  });

  it('codes sex from sex-assigned-at-birth, not gender identity (Ray: gender man, sab AFAB)', () => {
    const fmhs = build()
      .entry.map((e) => e.resource)
      .filter((r): r is FhirFamilyMemberHistory => r.resourceType === 'FamilyMemberHistory');
    const ray = fmhs.find((f) => f.name === 'Ray');
    expect(ray).toBeDefined();
    expect(ray!.sex.coding[0].code).toBe('female');
  });
});
