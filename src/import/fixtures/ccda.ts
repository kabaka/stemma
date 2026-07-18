/**
 * Realistic C-CDA (CCD) XML fixture builders for `ccda.test.ts`.
 *
 * These assemble minimal-but-structurally-real Continuity of Care Documents — a
 * `recordTarget` with a patient `birthTime`, a Problem Section (templateId
 * `2.16.840.1.113883.10.20.22.2.5`) of Problem Concern Acts wrapping Problem
 * Observations, and a Family History Section (`...2.15`) of organizers wrapping a
 * `relatedSubject` (RoleCode + demographics) and Family History Observations, each
 * optionally carrying a nested Age Observation. Deliberately no `xsi:` prefixed
 * attributes (they're never read by the parser and would need a namespace
 * declaration this fixture doesn't bother with) — every fact the parser reads
 * arrives as a plain `code`/`codeSystem`/`displayName`/`value`/`unit` attribute.
 */

export const OID = {
  icd10: '2.16.840.1.113883.6.90',
  snomed: '2.16.840.1.113883.6.96',
  icd9: '2.16.840.1.113883.6.103',
  roleCode: '2.16.840.1.113883.5.111',
};

export const TEMPLATE = {
  problemSection: '2.16.840.1.113883.10.20.22.2.5',
  problemConcernAct: '2.16.840.1.113883.10.20.22.4.3',
  problemObs: '2.16.840.1.113883.10.20.22.4.4',
  fhSection: '2.16.840.1.113883.10.20.22.2.15',
  fhOrganizer: '2.16.840.1.113883.10.20.22.4.45',
  fhObs: '2.16.840.1.113883.10.20.22.4.46',
  ageObs: '2.16.840.1.113883.10.20.22.4.31',
};

/** One coded (or narrative / negated / absent) problem to render into an observation. */
export interface FixtureProblem {
  system?: 'ICD-10-CM' | 'SNOMED-CT' | 'ICD-9-CM';
  code?: string;
  displayName?: string;
  /** Proband problem: diagnosis-date `effectiveTime/low`, `YYYYMMDD`. */
  onsetDate?: string;
  /** Proband problem: resolution date `effectiveTime/high` — must NEVER drive onset. */
  resolvedDate?: string;
  /** Family-history condition: age at onset in whole years (Age Observation). */
  ageYears?: number;
  /** Renders `negationInd="true"` on the observation. */
  negated?: boolean;
  /** Renders the value as this SNOMED "absence" code instead of a positive diagnosis. */
  absentSnomedCode?: string;
  /** Narrative-only: value carries no code, just an `originalText/reference` to `#id`
   * pointing at the section's own narrative table row (given via `narrativeId` + `narrativeText`). */
  narrativeRefId?: string;
  narrativeText?: string;
  /** Renders a `<translation>` child under the primary `<value>` carrying this SNOMED code —
   * used to build a fixture whose PRIMARY coding is a normal positive diagnosis but which also
   * carries an absence concept (e.g. `160266009`) only in a translation, never the primary code. */
  translationAbsentCode?: string;
}

function systemOid(system: FixtureProblem['system']): string {
  return system === 'SNOMED-CT' ? OID.snomed : system === 'ICD-9-CM' ? OID.icd9 : OID.icd10;
}

function valueXml(p: FixtureProblem): string {
  if (p.absentSnomedCode) {
    return `<value code="${p.absentSnomedCode}" codeSystem="${OID.snomed}" displayName="${p.displayName ?? 'No known problems'}"/>`;
  }
  if (p.narrativeRefId) {
    return `<value nullFlavor="OTH"><originalText><reference value="#${p.narrativeRefId}"/></originalText></value>`;
  }
  if (p.translationAbsentCode) {
    return `<value code="${p.code}" codeSystem="${systemOid(p.system)}" displayName="${p.displayName ?? ''}"><translation code="${p.translationAbsentCode}" codeSystem="${OID.snomed}" displayName="No known family history"/></value>`;
  }
  return `<value code="${p.code}" codeSystem="${systemOid(p.system)}" displayName="${p.displayName ?? ''}"/>`;
}

/** A Problem Observation, wrapped in its Problem Concern Act, for the Problem Section. */
function problemEntryXml(p: FixtureProblem): string {
  const negAttr = p.negated ? ' negationInd="true"' : '';
  const eff =
    p.onsetDate || p.resolvedDate
      ? `<effectiveTime>${p.onsetDate ? `<low value="${p.onsetDate}"/>` : ''}${
          p.resolvedDate ? `<high value="${p.resolvedDate}"/>` : ''
        }</effectiveTime>`
      : '';
  return `
    <entry typeCode="DRIV">
      <act classCode="ACT" moodCode="EVN">
        <templateId root="${TEMPLATE.problemConcernAct}"/>
        <code nullFlavor="NA"/>
        <statusCode code="active"/>
        <entryRelationship typeCode="SUBJ">
          <observation classCode="OBS" moodCode="EVN"${negAttr}>
            <templateId root="${TEMPLATE.problemObs}"/>
            <code code="55607006" codeSystem="${OID.snomed}" displayName="Problem"/>
            <statusCode code="completed"/>
            ${eff}
            ${valueXml(p)}
          </observation>
        </entryRelationship>
      </act>
    </entry>`;
}

function problemSectionXml(
  problems: FixtureProblem[],
  narrativeId?: string,
  narrativeText?: string,
): string {
  const narrativeRow = narrativeId
    ? `<table><tbody><tr ID="${narrativeId}"><td>${narrativeText ?? ''}</td></tr></tbody></table>`
    : '<table><tbody><tr><td>See entries.</td></tr></tbody></table>';
  return `
  <component>
    <section>
      <templateId root="${TEMPLATE.problemSection}"/>
      <templateId root="${TEMPLATE.problemSection}.1"/>
      <code code="11450-4" codeSystem="2.16.840.1.113883.6.1" displayName="Problem list"/>
      <title>Problems</title>
      <text>${narrativeRow}</text>
      ${problems.map(problemEntryXml).join('\n')}
    </section>
  </component>`;
}

/** One relative to render as a Family History organizer. */
export interface FixtureFamilyMember {
  relationshipCode: string;
  relationshipDisplay?: string;
  genderCode?: 'M' | 'F';
  name?: string;
  birthTime?: string;
  deceasedInd?: boolean;
  deceasedTime?: string;
  conditions?: FixtureProblem[];
}

function fhConditionXml(p: FixtureProblem): string {
  const negAttr = p.negated ? ' negationInd="true"' : '';
  const ageObs =
    p.ageYears != null
      ? `
      <entryRelationship typeCode="SUBJ">
        <observation classCode="OBS" moodCode="EVN">
          <templateId root="${TEMPLATE.ageObs}"/>
          <code code="445518008" codeSystem="${OID.snomed}" displayName="Age at onset"/>
          <value value="${p.ageYears}" unit="a"/>
        </observation>
      </entryRelationship>`
      : '';
  return `
    <entryRelationship typeCode="SUBJ">
      <observation classCode="OBS" moodCode="EVN"${negAttr}>
        <templateId root="${TEMPLATE.fhObs}"/>
        <code code="64572001" codeSystem="${OID.snomed}" displayName="Condition"/>
        ${valueXml(p)}
        ${ageObs}
      </observation>
    </entryRelationship>`;
}

function familyOrganizerXml(m: FixtureFamilyMember): string {
  const gender = m.genderCode
    ? `<administrativeGenderCode code="${m.genderCode}" codeSystem="2.16.840.1.113883.5.1"/>`
    : '';
  const birth = m.birthTime ? `<birthTime value="${m.birthTime}"/>` : '';
  const deceasedInd = m.deceasedInd != null ? `<deceasedInd value="${m.deceasedInd}"/>` : '';
  const deceasedTime = m.deceasedTime ? `<deceasedTime value="${m.deceasedTime}"/>` : '';
  const name = m.name ? `<name>${m.name}</name>` : '';
  const conditions = (m.conditions ?? []).map(fhConditionXml).join('\n');
  return `
  <entry typeCode="DRIV">
    <organizer classCode="CLUSTER" moodCode="EVN">
      <templateId root="${TEMPLATE.fhOrganizer}"/>
      <statusCode code="completed"/>
      <subject>
        <relatedSubject classCode="PRS">
          <code code="${m.relationshipCode}" codeSystem="${OID.roleCode}" displayName="${m.relationshipDisplay ?? ''}"/>
          <subject>
            ${name}
            ${gender}
            ${birth}
            ${deceasedInd}
            ${deceasedTime}
          </subject>
        </relatedSubject>
      </subject>
      ${conditions}
    </organizer>
  </entry>`;
}

function fhSectionXml(members: FixtureFamilyMember[]): string {
  return `
  <component>
    <section>
      <templateId root="${TEMPLATE.fhSection}"/>
      <code code="10157-6" codeSystem="2.16.840.1.113883.6.1" displayName="Family history"/>
      <title>Family History</title>
      <text><table><tbody><tr><td>See entries.</td></tr></tbody></table></text>
      ${members.map(familyOrganizerXml).join('\n')}
    </section>
  </component>`;
}

export interface CcdaDocOptions {
  patientBirthTime?: string;
  problems?: FixtureProblem[];
  problemNarrativeId?: string;
  problemNarrativeText?: string;
  familyMembers?: FixtureFamilyMember[];
}

/** A minimal, structurally real CCD ClinicalDocument built from the given content. */
export function ccdaDoc(opts: CcdaDocOptions): string {
  const problemSection = opts.problems
    ? problemSectionXml(opts.problems, opts.problemNarrativeId, opts.problemNarrativeText)
    : '';
  const fhSection = opts.familyMembers ? fhSectionXml(opts.familyMembers) : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<ClinicalDocument xmlns="urn:hl7-org:v3">
  <templateId root="2.16.840.1.113883.10.20.22.1.2"/>
  <code code="34133-9" codeSystem="2.16.840.1.113883.6.1" displayName="Summarization of episode note"/>
  <title>Continuity of Care Document</title>
  <effectiveTime value="20260101"/>
  <recordTarget>
    <patientRole>
      <id root="2.16.840.1.113883.19.5" extension="pat-1"/>
      <patient>
        <name><given>Jane</given><family>Doe</family></name>
        ${opts.patientBirthTime ? `<birthTime value="${opts.patientBirthTime}"/>` : ''}
      </patient>
    </patientRole>
  </recordTarget>
  <component>
    <structuredBody>
      ${problemSection}
      ${fhSection}
    </structuredBody>
  </component>
</ClinicalDocument>`;
}
