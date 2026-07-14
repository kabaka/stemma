import { describe, it, expect } from 'vitest';
import { buildPhenopacket } from './phenopacket';
import { seedRecord } from '@/data/seed';
import { buildCatalog } from '@/domain/catalog';

const NOW = '2026-07-14T12:00:00.000Z';
const catalog = buildCatalog([]);
const OPTS = { now: NOW, id: 'stemma-family-test', asOfYear: 2026 };

describe('buildPhenopacket', () => {
  it('sets the proband subject from the record proband', () => {
    const pp = buildPhenopacket(seedRecord(), catalog, OPTS);
    expect(pp.proband.subject.id).toBe('you');
    expect(pp.proband.subject.sex).toBe('FEMALE');
    expect(pp.proband.subject.timeAtLastEncounter?.age.iso8601duration).toBe('P38Y');
  });

  it('lists a phenotypic feature per proband condition, preferring HPO then SNOMED', () => {
    const pp = buildPhenopacket(seedRecord(), catalog, OPTS);
    expect(pp.proband.phenotypicFeatures).toHaveLength(3);
    // Hypothyroidism carries an HPO term, so the feature is coded to HPO (the native
    // Phenopacket phenotype vocabulary) in preference to SNOMED.
    const thy = pp.proband.phenotypicFeatures.find((f) => f.type.id === 'HP:0000821');
    expect(thy).toBeDefined();
    expect(thy!.onset?.age.iso8601duration).toBe('P28Y');
    // High cholesterol has no HPO term, so it falls back to SNOMED CT.
    const chol = pp.proband.phenotypicFeatures.find((f) => f.type.id === 'SNOMED:13644009');
    expect(chol).toBeDefined();
  });

  it('declares an HPO metaData Resource when a feature uses an HP: CURIE', () => {
    const pp = buildPhenopacket(seedRecord(), catalog, OPTS);
    expect(pp.metaData.resources.some((r) => r.namespacePrefix === 'HP')).toBe(true);
    expect(pp.metaData.resources.some((r) => r.namespacePrefix === 'SNOMED')).toBe(true);
  });

  it('includes every person in the pedigree with derived parentage', () => {
    const record = seedRecord();
    const pp = buildPhenopacket(record, catalog, OPTS);
    expect(pp.pedigree.persons).toHaveLength(record.people.length);
    const you = pp.pedigree.persons.find((x) => x.individualId === 'you');
    expect(you?.paternalId).toBe('robert');
    expect(you?.maternalId).toBe('susan');
    expect(you?.affectedStatus).toBe('AFFECTED');
  });

  it('records metadata created by Stemma and honours the id', () => {
    const pp = buildPhenopacket(seedRecord(), catalog, OPTS);
    expect(pp.metaData.createdBy).toBe('Stemma');
    expect(pp.metaData.phenopacketSchemaVersion).toBe('2.0');
    expect(pp.metaData.created).toBe(NOW);
    expect(pp.metaData.resources[0].namespacePrefix).toBe('SNOMED');
    expect(pp.id).toBe('stemma-family-test');
  });

  it('is deterministic given options', () => {
    expect(buildPhenopacket(seedRecord(), catalog, OPTS)).toEqual(
      buildPhenopacket(seedRecord(), catalog, OPTS),
    );
  });

  it('marks a deceased affected relative DECEASED in vitalStatus (Frank)', () => {
    const pp = buildPhenopacket(seedRecord(), catalog, OPTS);
    const frank = pp.relatives.find((r) => r.subject.id === 'frank');
    expect(frank).toBeDefined();
    expect(frank!.subject.vitalStatus?.status).toBe('DECEASED');
  });

  it('derives paternal/maternal pedigree ids from sex assigned at birth (Ray)', () => {
    const pp = buildPhenopacket(seedRecord(), catalog, OPTS);
    const ray = pp.pedigree.persons.find((x) => x.individualId === 'ray');
    expect(ray?.paternalId).toBe('tom');
    expect(ray?.maternalId).toBe('carol');
  });

  it('marks a condition-free relative UNAFFECTED and excludes them from relatives (Carol)', () => {
    const pp = buildPhenopacket(seedRecord(), catalog, OPTS);
    const carol = pp.pedigree.persons.find((x) => x.individualId === 'carol');
    expect(carol?.affectedStatus).toBe('UNAFFECTED');
    expect(pp.relatives.find((r) => r.subject.id === 'carol')).toBeUndefined();
  });
});
