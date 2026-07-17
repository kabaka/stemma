import { describe, expect, it } from 'vitest';
import { applyCcdaImport, parseCcda, stageCcdaImport } from './ccda';
import type { CcdaFamilyMember, CcdaSelections } from './ccda';
import { ccdaDoc } from './fixtures/ccda';
import { buildCatalog } from '@/domain/catalog';
import { emptyRecord, seedRecord } from '@/data/seed';
import { indexPeople, parentsOf, personById, relationInfo } from '@/domain/graph';
import { isValidRecord } from '@/domain/record';

const catalog = buildCatalog([]);

// ---------------------------------------------------------------------------
// parseCcda
// ---------------------------------------------------------------------------

describe('parseCcda — Problem Section (proband)', () => {
  it('extracts a coded diagnosis and computes onset age from patient birthTime + effectiveTime/low', () => {
    const xml = ccdaDoc({
      patientBirthTime: '19800615',
      problems: [
        {
          system: 'ICD-10-CM',
          code: 'C50.919',
          displayName: 'Malignant neoplasm of breast',
          onsetDate: '20150301',
        },
      ],
    });
    const parsed = parseCcda(xml);
    expect(parsed.proband.problems).toHaveLength(1);
    const p = parsed.proband.problems[0];
    expect(p.coded).toEqual({
      system: 'ICD-10-CM',
      code: 'C50.919',
      displayName: 'Malignant neoplasm of breast',
    });
    expect(p.onsetYear).toBe(35); // 2015 - 1980
  });

  it('ignores effectiveTime/high (the resolution date) — onset never comes from it', () => {
    const xml = ccdaDoc({
      patientBirthTime: '19800101',
      problems: [
        // Resolved condition: only a "high" (resolution) date, no diagnosis date.
        { system: 'ICD-10-CM', code: 'J45.909', displayName: 'Asthma', resolvedDate: '20200101' },
        // Both present: onset must come from "low", never from "high" (2020 - 1980 = 40 would
        // be the wrong answer a buggy implementation might produce).
        {
          system: 'ICD-10-CM',
          code: 'I10',
          displayName: 'Hypertension',
          onsetDate: '20100101',
          resolvedDate: '20200101',
        },
      ],
    });
    const [resolvedOnly, both] = parseCcda(xml).proband.problems;
    expect(resolvedOnly.onsetYear).toBeNull();
    expect(both.onsetYear).toBe(30); // 2010 - 1980, not 2020 - 1980
  });

  it('computes an onset age of exactly 0 when diagnosis year equals birth year (not treated as unknown)', () => {
    const xml = ccdaDoc({
      patientBirthTime: '19900101',
      problems: [
        { system: 'ICD-10-CM', code: 'I10', displayName: 'Hypertension', onsetDate: '19900615' },
      ],
    });
    expect(parseCcda(xml).proband.problems[0].onsetYear).toBe(0);
  });

  it('returns a null onset rather than a negative age when the diagnosis predates the recorded birth year', () => {
    const xml = ccdaDoc({
      patientBirthTime: '19900101',
      problems: [
        { system: 'ICD-10-CM', code: 'I10', displayName: 'Hypertension', onsetDate: '19800101' },
      ],
    });
    expect(parseCcda(xml).proband.problems[0].onsetYear).toBeNull();
  });

  it('returns a null onset when the patient birthTime is absent, never defaulting to 0', () => {
    const xml = ccdaDoc({
      problems: [
        { system: 'ICD-10-CM', code: 'I10', displayName: 'Hypertension', onsetDate: '20100101' },
      ],
    });
    expect(parseCcda(xml).proband.problems[0].onsetYear).toBeNull();
  });

  it('does not turn a negated problem into a positive condition', () => {
    const xml = ccdaDoc({
      patientBirthTime: '19800101',
      problems: [
        {
          system: 'ICD-10-CM',
          code: 'C50.919',
          displayName: 'Malignant neoplasm of breast',
          negated: true,
        },
      ],
    });
    const parsed = parseCcda(xml);
    expect(parsed.proband.problems).toHaveLength(0);
    expect(parsed.warnings.some((w) => /1 negated.*not imported/i.test(w))).toBe(true);
  });

  it('surfaces an ICD-9-only (legacy) entry as uncoded rather than crosswalking it to ICD-10/SNOMED', () => {
    const xml = ccdaDoc({
      patientBirthTime: '19800101',
      problems: [{ system: 'ICD-9-CM', code: '250.00', displayName: 'Diabetes mellitus' }],
    });
    const p = parseCcda(xml).proband.problems[0];
    expect(p.coded).toEqual({ system: null, code: null, displayName: 'Diabetes mellitus' });
  });

  it('surfaces a narrative-only entry (no code at all) verbatim via its referenced narrative text', () => {
    const xml = ccdaDoc({
      patientBirthTime: '19800101',
      problems: [{ narrativeRefId: 'probNarr1' }],
      problemNarrativeId: 'probNarr1',
      problemNarrativeText: 'Reports intermittent low back pain',
    });
    const p = parseCcda(xml).proband.problems[0];
    expect(p.coded).toEqual({
      system: null,
      code: null,
      displayName: 'Reports intermittent low back pain',
    });
  });
});

describe('parseCcda — Family History Section', () => {
  it('extracts a relative with relationshipCode, sab from administrativeGenderCode, deceased flag + birth year, and a condition whose onset comes directly from the Age Observation', () => {
    const xml = ccdaDoc({
      familyMembers: [
        {
          relationshipCode: 'MTH',
          relationshipDisplay: 'Mother',
          genderCode: 'F',
          name: 'Jane Smith',
          birthTime: '1950',
          deceasedInd: true,
          deceasedTime: '2015',
          conditions: [
            {
              system: 'ICD-10-CM',
              code: 'C50.919',
              displayName: 'Malignant neoplasm of breast',
              ageYears: 45,
            },
          ],
        },
      ],
    });
    const m = parseCcda(xml).familyMembers[0];
    expect(m.relationshipCode).toBe('MTH');
    expect(m.sab).toBe('f');
    expect(m.name).toBe('Jane Smith');
    expect(m.birthYear).toBe(1950);
    expect(m.death).toEqual({ year: 2015, dead: true });
    expect(m.problems).toHaveLength(1);
    // The Age Observation is used AS THE ONSET DIRECTLY — never re-derived from any date math.
    expect(m.problems[0].onsetYear).toBe(45);
  });

  it('leaves birthYear null when the relative carries no birthTime, without defaulting', () => {
    const xml = ccdaDoc({
      familyMembers: [{ relationshipCode: 'BRO', genderCode: 'M', name: 'Sam' }],
    });
    expect(parseCcda(xml).familyMembers[0].birthYear).toBeNull();
  });

  it('never infers sab from a sex-neutral RoleCode absent an administrativeGenderCode', () => {
    const noGender = ccdaDoc({ familyMembers: [{ relationshipCode: 'SIB', name: 'Alex' }] });
    expect(parseCcda(noGender).familyMembers[0].sab).toBe('u');

    const withGender = ccdaDoc({
      familyMembers: [{ relationshipCode: 'SIB', genderCode: 'F', name: 'Alex' }],
    });
    expect(parseCcda(withGender).familyMembers[0].sab).toBe('f');
  });

  it('falls back to a sex-SPECIFIC RoleCode only when administrativeGenderCode is absent', () => {
    const xml = ccdaDoc({ familyMembers: [{ relationshipCode: 'MTH', name: 'Jane' }] });
    expect(parseCcda(xml).familyMembers[0].sab).toBe('f');
  });

  it('does not turn a "no known family history of X" absence assertion into a positive condition', () => {
    const xml = ccdaDoc({
      familyMembers: [
        {
          relationshipCode: 'MTH',
          genderCode: 'F',
          name: 'Jane',
          conditions: [
            {
              absentSnomedCode: '160266009',
              displayName: 'No known family history of breast cancer',
            },
          ],
        },
      ],
    });
    const parsed = parseCcda(xml);
    expect(parsed.familyMembers[0].problems).toHaveLength(0);
    expect(parsed.warnings.some((w) => /1 negated.*not imported/i.test(w))).toBe(true);
  });
});

describe('parseCcda — security & leniency (never throws)', () => {
  it('rejects a document declaring a DOCTYPE, with a structured warning and no crash', () => {
    const xxe =
      '<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><ClinicalDocument/>';
    const parsed = parseCcda(xxe);
    expect(parsed.proband.problems).toEqual([]);
    expect(parsed.familyMembers).toEqual([]);
    expect(parsed.warnings.some((w) => /DOCTYPE/i.test(w))).toBe(true);
  });

  it('reports a parser error as a warning instead of throwing on malformed XML', () => {
    const malformed = '<ClinicalDocument><recordTarget></ClinicalDocument>'; // unclosed recordTarget
    expect(() => parseCcda(malformed)).not.toThrow();
    const parsed = parseCcda(malformed);
    expect(parsed.warnings.some((w) => /not well-formed/i.test(w))).toBe(true);
  });

  it('warns and does not throw on an oversized input', () => {
    const huge = 'A'.repeat(17 * 1024 * 1024);
    expect(() => parseCcda(huge)).not.toThrow();
    expect(parseCcda(huge).warnings.some((w) => /too large/i.test(w))).toBe(true);
  });

  it('warns when neither a problem list nor a family history section is present', () => {
    const parsed = parseCcda(ccdaDoc({}));
    expect(parsed.warnings.some((w) => /No problem list or family history/i.test(w))).toBe(true);
  });

  it('never throws on empty, non-XML, or otherwise hostile input', () => {
    for (const bad of ['', '   ', 'not xml at all', '<<<>>>', '{}', '  ', 'null']) {
      expect(() => parseCcda(bad)).not.toThrow();
    }
    expect(parseCcda('').warnings[0]).toMatch(/empty/i);
  });
});

// ---------------------------------------------------------------------------
// stageCcdaImport
// ---------------------------------------------------------------------------

describe('stageCcdaImport — condition resolution', () => {
  it('resolves an exact curated ICD-10-CM code to its catalog slug, defaulting it ON', () => {
    const xml = ccdaDoc({
      patientBirthTime: '19900101',
      problems: [{ system: 'ICD-10-CM', code: 'E11.9', displayName: 'Type 2 diabetes mellitus' }],
    });
    const staged = stageCcdaImport(parseCcda(xml), emptyRecord(), catalog);
    expect(staged.probandConditions[0]).toMatchObject({
      suggestedConditionId: 't2d',
      status: 'new',
      defaultSelected: true,
    });
  });

  it('resolves an ICD-10-CM code with no exact match via the 3-character-category fallback', () => {
    const xml = ccdaDoc({
      patientBirthTime: '19900101',
      // No curated condition carries E11.42 exactly; E11 (t2d) does, via the category index.
      problems: [
        { system: 'ICD-10-CM', code: 'E11.42', displayName: 'T2DM with diabetic polyneuropathy' },
      ],
    });
    const staged = stageCcdaImport(parseCcda(xml), emptyRecord(), catalog);
    expect(staged.probandConditions[0].suggestedConditionId).toBe('t2d');
    expect(staged.probandConditions[0].status).toBe('new');
  });

  it('treats a real ICD-10-CM code with no curated match at all as its own long-tail suggestion', () => {
    const xml = ccdaDoc({
      patientBirthTime: '19900101',
      problems: [
        { system: 'ICD-10-CM', code: 'S72.001A', displayName: 'Fracture of neck of right femur' },
      ],
    });
    const staged = stageCcdaImport(parseCcda(xml), emptyRecord(), catalog);
    expect(staged.probandConditions[0]).toMatchObject({
      suggestedConditionId: 'S72.001A',
      status: 'new',
      defaultSelected: true,
    });
  });

  it('resolves a curated SNOMED-CT code to its catalog slug', () => {
    const xml = ccdaDoc({
      patientBirthTime: '19900101',
      problems: [{ system: 'SNOMED-CT', code: '38341003', displayName: 'Hypertension' }],
    });
    const staged = stageCcdaImport(parseCcda(xml), emptyRecord(), catalog);
    expect(staged.probandConditions[0]).toMatchObject({
      suggestedConditionId: 'htn',
      status: 'new',
    });
  });

  it('surfaces a SNOMED-only code with no curated match as needs-review, preserving code + display verbatim, defaulted OFF', () => {
    const xml = ccdaDoc({
      patientBirthTime: '19900101',
      problems: [
        {
          system: 'SNOMED-CT',
          code: '444814009',
          displayName: 'Rare inherited metabolic disorder',
        },
      ],
    });
    const staged = stageCcdaImport(parseCcda(xml), emptyRecord(), catalog);
    expect(staged.probandConditions[0]).toMatchObject({
      suggestedConditionId: '444814009',
      displayName: 'Rare inherited metabolic disorder',
      status: 'needs-review',
      defaultSelected: false,
    });
  });

  it('surfaces a narrative-only (uncoded) entry as needs-review with a null suggestion, defaulted OFF', () => {
    const xml = ccdaDoc({
      patientBirthTime: '19900101',
      problems: [{ narrativeRefId: 'n1' }],
      problemNarrativeId: 'n1',
      problemNarrativeText: 'Chronic low back pain, unspecified cause',
    });
    const staged = stageCcdaImport(parseCcda(xml), emptyRecord(), catalog);
    expect(staged.probandConditions[0]).toMatchObject({
      suggestedConditionId: null,
      displayName: 'Chronic low back pain, unspecified cause',
      status: 'needs-review',
      defaultSelected: false,
    });
  });

  it('flags a proband problem already on the record as a duplicate, defaulting it OFF', () => {
    // seedRecord's proband ("you") already carries hypothyroidism (icd10 E03.9 -> 'thy').
    const xml = ccdaDoc({
      patientBirthTime: '19880101',
      problems: [
        { system: 'ICD-10-CM', code: 'E03.9', displayName: 'Hypothyroidism, unspecified' },
      ],
    });
    const staged = stageCcdaImport(parseCcda(xml), seedRecord(), catalog);
    expect(staged.probandConditions[0]).toMatchObject({
      suggestedConditionId: 'thy',
      status: 'duplicate',
      defaultSelected: false,
    });
  });
});

describe('stageCcdaImport — relationship placement (safety-critical)', () => {
  const record = seedRecord(); // proband "you"; parents robert(m)/susan(f); siblings jack, emma;
  // children zoe, leo; paternal grandparents frank/marie; maternal grandparents george/helen.

  function fam(overrides: Partial<CcdaFamilyMember>): CcdaFamilyMember {
    return {
      parseId: 'fh-x',
      name: null,
      sab: 'u',
      relationshipCode: 'BRO',
      relationshipDisplay: 'Brother',
      birthYear: null,
      death: { year: null, dead: null },
      problems: [],
      ...overrides,
    };
  }

  function stageOne(member: Partial<CcdaFamilyMember>) {
    const parsed = { proband: { problems: [] }, familyMembers: [fam(member)], warnings: [] };
    return stageCcdaImport(parsed, record, catalog).familyMembers[0];
  }

  it("auto-places MTH/FTH as the proband's parent, matching an existing same-name parent exactly", () => {
    expect(stageOne({ relationshipCode: 'MTH', name: 'Susan' })).toMatchObject({
      placement: { anchorId: 'you', relation: 'parent' },
      matchStatus: 'matched-existing',
      matchedPersonId: 'susan',
    });
    expect(stageOne({ relationshipCode: 'FTH', name: 'Robert' })).toMatchObject({
      matchStatus: 'matched-existing',
      matchedPersonId: 'robert',
    });
  });

  it('flags MTH/FTH ambiguous (not auto-merged) when the name does not match either existing parent', () => {
    const staged = stageOne({ relationshipCode: 'MTH', name: 'Someone Else' });
    expect(staged.matchStatus).toBe('ambiguous');
    expect(staged.matchedPersonId).toBeNull();
    expect(staged.candidates.map((c) => c.personId).sort()).toEqual(['robert', 'susan']);
    expect(staged.defaultSelected).toBe(false);
  });

  it('auto-places BRO/SIS as a sibling, matching an existing sibling by normalized name', () => {
    expect(stageOne({ relationshipCode: 'BRO', name: '  JACK  ' })).toMatchObject({
      placement: { anchorId: 'you', relation: 'sibling' },
      matchStatus: 'matched-existing',
      matchedPersonId: 'jack',
    });
  });

  it('flags a same-position sibling ambiguous when no name is given (never guesses a match)', () => {
    const staged = stageOne({ relationshipCode: 'SIS', name: null });
    expect(staged.matchStatus).toBe('ambiguous');
    expect(staged.matchedPersonId).toBeNull();
  });

  it('auto-places SON/DAU as a child, matching an existing child by name', () => {
    expect(stageOne({ relationshipCode: 'DAU', name: 'Zoe' })).toMatchObject({
      placement: { anchorId: 'you', relation: 'child' },
      matchStatus: 'matched-existing',
      matchedPersonId: 'zoe',
    });
  });

  it('adds a genuinely new sibling with no ambiguity when the record has no existing siblings to conflict with', () => {
    const parsed = {
      proband: { problems: [] },
      familyMembers: [fam({ relationshipCode: 'BRO', name: 'Only' })],
      warnings: [],
    };
    const staged = stageCcdaImport(parsed, emptyRecord(), catalog).familyMembers[0];
    expect(staged.matchStatus).toBe('new-person');
    expect(staged.defaultSelected).toBe(true);
    expect(staged.placement).toEqual({ anchorId: 'you', relation: 'sibling' });
  });

  it('never auto-places a half-sibling into direct genetic sibling status (surfaced ambiguous)', () => {
    const staged = stageOne({ relationshipCode: 'HBRO', name: 'Half Brother' });
    expect(staged.placement).toBeNull();
    expect(staged.matchStatus).toBe('ambiguous');
    expect(staged.defaultSelected).toBe(false);
  });

  it('never auto-places a side-unknown grandparent, aunt/uncle, or cousin (surfaced ambiguous)', () => {
    for (const code of ['GRMTH', 'GRFTH', 'AUNT', 'UNCLE', 'COUSN']) {
      const staged = stageOne({ relationshipCode: code, name: 'Someone' });
      expect(staged.placement).toBeNull();
      expect(staged.matchStatus).toBe('ambiguous');
    }
  });

  it('never auto-places an in-law or step-relative into genetic parentage, however cancer-relevant their history', () => {
    for (const code of ['MTHINLAW', 'FTHINLAW', 'STPMTH', 'STPFTH']) {
      const staged = stageOne({
        relationshipCode: code,
        name: 'Someone',
        problems: [
          {
            parseId: 'p1',
            coded: { system: 'ICD-10-CM', code: 'C50.919', displayName: 'Breast cancer' },
            onsetYear: 40,
          },
        ],
      });
      expect(staged.placement).toBeNull();
      expect(staged.matchStatus).toBe('ambiguous');
      expect(staged.defaultSelected).toBe(false);
    }
  });

  it('auto-places a side-specified grandparent (MGRMTH) only when the linking parent already exists in the record', () => {
    // Maternal grandmother: links through susan (the recorded mother, sab 'f'). susan's own
    // parents (george, helen) already exist — Helen matches by name.
    expect(stageOne({ relationshipCode: 'MGRMTH', name: 'Helen' })).toMatchObject({
      placement: { anchorId: 'susan', relation: 'parent' },
      matchStatus: 'matched-existing',
      matchedPersonId: 'helen',
    });
    // Paternal grandfather: links through robert (sab 'm'); robert's parents are frank & marie.
    expect(stageOne({ relationshipCode: 'PGRFTH', name: 'Frank' })).toMatchObject({
      placement: { anchorId: 'robert', relation: 'parent' },
      matchStatus: 'matched-existing',
      matchedPersonId: 'frank',
    });
  });

  it('surfaces a side-specified grandparent (MGRMTH) as ambiguous when the linking parent does not exist yet', () => {
    // emptyRecord's proband has no recorded mother at all, so there is nothing to hang a
    // "maternal" grandmother off of — never invent the missing parent to attach it anyway.
    const parsed = {
      proband: { problems: [] },
      familyMembers: [fam({ relationshipCode: 'MGRMTH', name: 'Grandma' })],
      warnings: [],
    };
    const staged = stageCcdaImport(parsed, emptyRecord(), catalog).familyMembers[0];
    expect(staged.placement).toBeNull();
    expect(staged.matchStatus).toBe('ambiguous');
    expect(staged.defaultSelected).toBe(false);
  });

  it('marks a matched-existing or new-person relative selected by default, but never an ambiguous one', () => {
    expect(stageOne({ relationshipCode: 'MTH', name: 'Susan' }).defaultSelected).toBe(true); // matched
    const parsed = {
      proband: { problems: [] },
      familyMembers: [fam({ relationshipCode: 'BRO', name: 'New Guy' })],
      warnings: [],
    };
    expect(stageCcdaImport(parsed, emptyRecord(), catalog).familyMembers[0].defaultSelected).toBe(
      true,
    ); // new-person
    expect(stageOne({ relationshipCode: 'COUSN', name: 'Someone' }).defaultSelected).toBe(false); // ambiguous
  });
});

// ---------------------------------------------------------------------------
// applyCcdaImport
// ---------------------------------------------------------------------------

describe('applyCcdaImport', () => {
  it('applies only checked parseIds — an unselected staged condition never appears on the record', () => {
    const xml = ccdaDoc({
      patientBirthTime: '19900101',
      problems: [
        {
          system: 'ICD-10-CM',
          code: 'E11.9',
          displayName: 'Type 2 diabetes mellitus',
          onsetDate: '20200101',
        },
        {
          system: 'ICD-10-CM',
          code: 'F32.9',
          displayName: 'Major depressive disorder',
          onsetDate: '20210101',
        },
      ],
    });
    const record = emptyRecord();
    const staged = stageCcdaImport(parseCcda(xml), record, catalog);
    const [t2d, dep] = staged.probandConditions;
    const selections: CcdaSelections = { selectedParseIds: new Set([t2d.parseId]) };
    const { record: applied } = applyCcdaImport(record, staged, selections, catalog);
    const proband = applied.people.find((p) => p.id === applied.probandId)!;
    expect(proband.conds.map((c) => c.id)).toEqual(['t2d']);
    expect(proband.conds.map((c) => c.id)).not.toContain(dep.suggestedConditionId);
  });

  it('attaches every imported condition with prov "record" and the staged onset verbatim', () => {
    const xml = ccdaDoc({
      patientBirthTime: '19900101',
      problems: [
        {
          system: 'ICD-10-CM',
          code: 'E11.9',
          displayName: 'Type 2 diabetes',
          onsetDate: '20200101',
        },
      ],
    });
    const record = emptyRecord();
    const staged = stageCcdaImport(parseCcda(xml), record, catalog);
    const selections: CcdaSelections = {
      selectedParseIds: new Set(staged.probandConditions.map((c) => c.parseId)),
    };
    const { record: applied } = applyCcdaImport(record, staged, selections, catalog);
    const proband = applied.people.find((p) => p.id === applied.probandId)!;
    expect(proband.conds).toEqual([{ id: 't2d', onset: 30, prov: 'record' }]);
  });

  it('never mutates the input record', () => {
    const record = seedRecord();
    const before = structuredClone(record);
    const xml = ccdaDoc({
      patientBirthTime: '19880101',
      problems: [
        {
          system: 'ICD-10-CM',
          code: 'F41.9',
          displayName: 'Anxiety disorder',
          onsetDate: '20100101',
        },
      ],
    });
    const staged = stageCcdaImport(parseCcda(xml), record, catalog);
    applyCcdaImport(
      record,
      staged,
      { selectedParseIds: new Set(staged.probandConditions.map((c) => c.parseId)) },
      catalog,
    );
    expect(record).toEqual(before);
  });

  it('registers long-tail extensions only for codes with no curated catalog entry', () => {
    const record = seedRecord();
    const xml = ccdaDoc({
      patientBirthTime: '19880101',
      problems: [
        // curated, new
        {
          system: 'ICD-10-CM',
          code: 'E11.9',
          displayName: 'Type 2 diabetes',
          onsetDate: '20200101',
        },
        // curated, but already on the proband (a dedup no-op, must not surface as an extension)
        {
          system: 'ICD-10-CM',
          code: 'E03.9',
          displayName: 'Hypothyroidism, unspecified',
          onsetDate: '20000101',
        },
        // long-tail, no curated match
        {
          system: 'ICD-10-CM',
          code: 'S72.001A',
          displayName: 'Fracture of neck of right femur',
          onsetDate: '20220101',
        },
      ],
    });
    const staged = stageCcdaImport(parseCcda(xml), record, catalog);
    const selections: CcdaSelections = {
      selectedParseIds: new Set(staged.probandConditions.map((c) => c.parseId)),
    };
    const { record: applied, extensions } = applyCcdaImport(record, staged, selections, catalog);

    const proband = applied.people.find((p) => p.id === applied.probandId)!;
    expect(proband.conds.filter((c) => c.id === 'thy')).toHaveLength(1); // still exactly one, not two
    expect(proband.conds.map((c) => c.id)).toContain('t2d');
    expect(proband.conds.map((c) => c.id)).toContain('S72.001A');

    expect(extensions.map((e) => e.id)).toEqual(['S72.001A']);
    expect(extensions[0].icd10).toBe('S72.001A');
    expect(extensions[0].cat).toBe('other');
  });

  it('produces a fully valid record after a combined proband + family-history import', () => {
    const record = seedRecord();
    const xml = ccdaDoc({
      patientBirthTime: '19880101',
      problems: [
        {
          system: 'ICD-10-CM',
          code: 'E11.9',
          displayName: 'Type 2 diabetes',
          onsetDate: '20200101',
        },
      ],
      familyMembers: [
        {
          relationshipCode: 'MGRMTH',
          genderCode: 'F',
          name: 'Helen',
          conditions: [
            { system: 'ICD-10-CM', code: 'C50.919', displayName: 'Breast cancer', ageYears: 60 },
          ],
        },
      ],
    });
    const staged = stageCcdaImport(parseCcda(xml), record, catalog);
    const allParseIds = [
      ...staged.probandConditions.map((c) => c.parseId),
      ...staged.familyMembers.map((m) => m.parseId),
      ...staged.familyMembers.flatMap((m) => m.conditions.map((c) => c.parseId)),
    ];
    const { record: applied } = applyCcdaImport(
      record,
      staged,
      { selectedParseIds: new Set(allParseIds) },
      catalog,
    );
    expect(isValidRecord(applied)).toBe(true);
  });

  it('lands an auto-placed mother as an actual genetic parent of the proband (graph-verified)', () => {
    const record = emptyRecord(); // proband has no recorded parents at all
    const xml = ccdaDoc({
      familyMembers: [
        {
          relationshipCode: 'MTH',
          relationshipDisplay: 'Mother',
          genderCode: 'F',
          name: 'Grace Doe',
          birthTime: '1955',
          conditions: [
            { system: 'ICD-10-CM', code: 'E11.9', displayName: 'Type 2 diabetes', ageYears: 50 },
          ],
        },
      ],
    });
    const staged = stageCcdaImport(parseCcda(xml), record, catalog);
    const member = staged.familyMembers[0];
    expect(member.matchStatus).toBe('new-person'); // no existing parent to conflict with
    const selections: CcdaSelections = {
      selectedParseIds: new Set([member.parseId, ...member.conditions.map((c) => c.parseId)]),
    };
    const { record: applied } = applyCcdaImport(record, staged, selections, catalog);

    const idx = indexPeople(applied.people, applied.unions);
    const motherIds = parentsOf(idx, applied.probandId);
    expect(motherIds).toHaveLength(1);
    const mother = personById(idx, motherIds[0])!;
    expect(mother.name).toBe('Grace Doe');
    expect(mother.sab).toBe('f');
    expect(mother.birth).toBe(1955);
    expect(relationInfo(idx, mother.id, applied.probandId).rel).toBe('Mother');
    expect(mother.conds).toEqual([{ id: 't2d', onset: 50, prov: 'record' }]);
  });

  it('defaults display gender from sab (never invented independently) for a newly-added relative', () => {
    const record = emptyRecord();
    const xml = ccdaDoc({ familyMembers: [{ relationshipCode: 'CHILD', name: 'Kid' }] }); // sex-neutral, no gender code
    const staged = stageCcdaImport(parseCcda(xml), record, catalog);
    const member = staged.familyMembers[0];
    const { record: applied } = applyCcdaImport(
      record,
      staged,
      { selectedParseIds: new Set([member.parseId]) },
      catalog,
    );
    const kid = applied.people.find((p) => p.name === 'Kid')!;
    expect(kid.sab).toBe('u');
    expect(kid.gender).toBe('nb');
  });

  it('applies an ambiguous relative via a user matchedPersonId override, merging into the existing person', () => {
    const record = seedRecord();
    const xml = ccdaDoc({
      familyMembers: [
        {
          relationshipCode: 'SIS',
          genderCode: 'F',
          name: 'Totally Different Name', // no name match -> ambiguous against jack/emma
          conditions: [
            { system: 'ICD-10-CM', code: 'F41.9', displayName: 'Anxiety disorder', ageYears: 25 },
          ],
        },
      ],
    });
    const staged = stageCcdaImport(parseCcda(xml), record, catalog);
    const member = staged.familyMembers[0];
    expect(member.matchStatus).toBe('ambiguous');

    const selections: CcdaSelections = {
      selectedParseIds: new Set([member.parseId, ...member.conditions.map((c) => c.parseId)]),
      overrides: { [member.parseId]: { matchedPersonId: 'emma' } },
    };
    const { record: applied } = applyCcdaImport(record, staged, selections, catalog);

    expect(applied.people).toHaveLength(record.people.length); // no new node added
    const emma = applied.people.find((p) => p.id === 'emma')!;
    expect(emma.conds).toEqual(expect.arrayContaining([{ id: 'anx', onset: 25, prov: 'record' }]));
  });

  it('applies an ambiguous relative via a user placement override, adding a new person at the chosen position', () => {
    const record = seedRecord();
    const xml = ccdaDoc({
      familyMembers: [{ relationshipCode: 'AUNT', genderCode: 'F', name: 'New Aunt' }],
    });
    const staged = stageCcdaImport(parseCcda(xml), record, catalog);
    const member = staged.familyMembers[0];
    expect(member.placement).toBeNull(); // AUNT never auto-places

    const selections: CcdaSelections = {
      selectedParseIds: new Set([member.parseId]),
      overrides: { [member.parseId]: { placement: { anchorId: 'you', relation: 'sibling' } } },
    };
    const { record: applied } = applyCcdaImport(record, staged, selections, catalog);

    const newPerson = applied.people.find((p) => p.name === 'New Aunt');
    expect(newPerson).toBeDefined();
    const sibshipUnion = applied.unions.find((u) => u.children.includes('you'));
    expect(sibshipUnion?.children).toContain(newPerson!.id);
  });

  it('skips an ambiguous relative entirely when the user supplies no override', () => {
    const record = seedRecord();
    const xml = ccdaDoc({
      familyMembers: [
        {
          relationshipCode: 'AUNT',
          genderCode: 'F',
          name: 'Unresolved Aunt',
          conditions: [
            { system: 'ICD-10-CM', code: 'F41.9', displayName: 'Anxiety disorder', ageYears: 40 },
          ],
        },
      ],
    });
    const staged = stageCcdaImport(parseCcda(xml), record, catalog);
    const member = staged.familyMembers[0];
    const selections: CcdaSelections = {
      selectedParseIds: new Set([member.parseId, ...member.conditions.map((c) => c.parseId)]),
      // no overrides supplied
    };
    const { record: applied, extensions } = applyCcdaImport(record, staged, selections, catalog);

    expect(applied.people).toHaveLength(record.people.length); // nobody added
    expect(applied.people.some((p) => p.name === 'Unresolved Aunt')).toBe(false);
    expect(extensions).toEqual([]); // the condition was never attached anywhere
  });
});
