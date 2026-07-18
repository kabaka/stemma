import { describe, expect, it } from 'vitest';
import { selectScopes } from './scopes';

const BASE = [
  'openid',
  'fhirUser',
  'launch/patient',
  'patient/Patient.read',
  'patient/Condition.read',
  'patient/Observation.read',
  'patient/MedicationStatement.read',
];

describe('selectScopes', () => {
  it('returns the full set unchanged when the server advertises no scopes_supported', () => {
    expect(selectScopes(BASE, undefined)).toEqual(BASE);
    expect(selectScopes(BASE, [])).toEqual(BASE);
  });

  it('does NOT trim when the server enumerates only identity scopes (the Epic case)', () => {
    // Epic's real .well-known lists no patient/* scopes — trimming against it would strip everything.
    const epic = ['epic.scanning.dmsusername', 'fhirUser', 'launch', 'openid', 'profile'];
    expect(selectScopes(BASE, epic)).toEqual(BASE);
  });

  it('trims requested resource scopes the server does not enumerate', () => {
    const supported = [
      'openid',
      'fhirUser',
      'launch/patient',
      'patient/Patient.read',
      'patient/Condition.read',
      'patient/Observation.read',
      // MedicationStatement deliberately absent
    ];
    expect(selectScopes(BASE, supported)).toEqual([
      'openid',
      'fhirUser',
      'launch/patient',
      'patient/Patient.read',
      'patient/Condition.read',
      'patient/Observation.read',
    ]);
  });

  it('matches on resource name so a v2 (.rs) server keeps our v1 (.read) request', () => {
    const v2 = [
      'patient/Patient.rs',
      'patient/Condition.rs',
      'patient/Observation.rs',
      'patient/MedicationStatement.rs',
    ];
    // Every requested resource is advertised (in .rs form) → nothing trimmed.
    expect(selectScopes(BASE, v2)).toEqual(BASE);
  });

  it('honors a wildcard resource (patient/*.read) as "all supported"', () => {
    expect(selectScopes(BASE, ['patient/*.read', 'openid'])).toEqual(BASE);
    expect(selectScopes(BASE, ['patient/*.rs'])).toEqual(BASE);
  });

  it('always keeps identity/launch scopes even when the server enumerates resources', () => {
    const supported = ['patient/Patient.rs']; // enumerates resources, lists no identity scopes
    const result = selectScopes(BASE, supported);
    expect(result).toContain('openid');
    expect(result).toContain('fhirUser');
    expect(result).toContain('launch/patient');
    expect(result).toContain('patient/Patient.read');
    expect(result).not.toContain('patient/Condition.read'); // Condition not advertised → trimmed
  });

  it('keeps offline_access when present and never rewrites or reorders survivors', () => {
    const requested = [...BASE, 'offline_access'];
    const supported = ['patient/Patient.rs', 'patient/Condition.rs', 'patient/Observation.rs'];
    expect(selectScopes(requested, supported)).toEqual([
      'openid',
      'fhirUser',
      'launch/patient',
      'patient/Patient.read',
      'patient/Condition.read',
      'patient/Observation.read',
      'offline_access',
    ]);
  });

  it('never mutates the input array', () => {
    const requested = [...BASE];
    selectScopes(requested, ['patient/Patient.rs']);
    expect(requested).toEqual(BASE);
  });

  it('keys resource scopes by context, so a user-context advertisement does not keep a patient-context request', () => {
    // Server enumerates Observation only under `user`, not `patient` — the two contexts are
    // distinct keys, so the patient/Observation request must be dropped even though a same-named
    // resource is advertised under a different context.
    expect(
      selectScopes(
        ['patient/Observation.read', 'patient/Condition.read'],
        ['user/Observation.read', 'patient/Condition.read'],
      ),
    ).toEqual(['patient/Condition.read']);
  });

  it('treats a wildcard as scoped to its own context, not global', () => {
    // patient/*.rs covers every patient/<resource> request...
    expect(
      selectScopes(['patient/Observation.read', 'patient/Condition.read'], ['patient/*.rs']),
    ).toEqual(['patient/Observation.read', 'patient/Condition.read']);
    // ...but does not cover a user-context request that the server never otherwise advertises.
    expect(
      selectScopes(['patient/Observation.read', 'user/Observation.read'], ['patient/*.rs']),
    ).toEqual(['patient/Observation.read']);
  });
});
