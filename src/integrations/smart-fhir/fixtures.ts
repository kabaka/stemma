/**
 * Realistic SMART-on-FHIR discovery + token fixtures for `discovery.test.ts` and
 * `gateway.test.ts`. Shapes mirror what a real EHR sandbox (Epic App Orchard) returns —
 * hand-authored against the SMART App Launch IG (`.well-known/smart-configuration`) and the
 * `CapabilityStatement` `oauth-uris` fallback extension (used by servers that predate the
 * well-known endpoint), never invented ad hoc per test.
 */

/** A `.well-known/smart-configuration` document, Epic-shaped (the capabilities/scopes an Epic
 * sandbox actually advertises for a standalone public client). */
export const wellKnownSmartConfig = {
  issuer: 'https://ehr.example.org/fhir',
  authorization_endpoint: 'https://ehr.example.org/oauth2/authorize',
  token_endpoint: 'https://ehr.example.org/oauth2/token',
  token_endpoint_auth_methods_supported: ['none'],
  capabilities: [
    'launch-standalone',
    'client-public',
    'sso-openid-connect',
    'context-standalone-patient',
    'permission-patient',
    'permission-offline',
  ],
  code_challenge_methods_supported: ['S256'],
  scopes_supported: [
    'openid',
    'fhirUser',
    'launch/patient',
    'patient/Patient.read',
    'patient/Condition.read',
    'patient/FamilyMemberHistory.read',
    'offline_access',
  ],
};

/** The canonical SMART "OAuth URIs" CapabilityStatement extension — the `/metadata` fallback
 * used when a server has no `.well-known/smart-configuration` document. */
const OAUTH_URIS_EXTENSION_URL =
  'http://fhir-registry.smarthealthit.org/StructureDefinition/oauth-uris';

/** A `CapabilityStatement` (`GET /metadata`) carrying the `oauth-uris` extension. */
export const capabilityStatementWithOAuthUris = {
  resourceType: 'CapabilityStatement',
  status: 'active',
  fhirVersion: '4.0.1',
  rest: [
    {
      mode: 'server',
      security: {
        service: [
          {
            coding: [
              {
                system: 'http://terminology.hl7.org/CodeSystem/restful-security-service',
                code: 'SMART-on-FHIR',
              },
            ],
          },
        ],
        extension: [
          {
            url: OAUTH_URIS_EXTENSION_URL,
            extension: [
              { url: 'authorize', valueUri: 'https://ehr.example.org/oauth/authorize' },
              { url: 'token', valueUri: 'https://ehr.example.org/oauth/token' },
            ],
          },
        ],
      },
      resource: [{ type: 'Patient' }, { type: 'Condition' }, { type: 'FamilyMemberHistory' }],
    },
  ],
};

/** The same shape with no `oauth-uris` extension at all — the fallback-failure case. */
export const capabilityStatementWithoutOAuthUris = {
  resourceType: 'CapabilityStatement',
  status: 'active',
  fhirVersion: '4.0.1',
  rest: [
    {
      mode: 'server',
      security: {
        service: [
          {
            coding: [
              {
                system: 'http://terminology.hl7.org/CodeSystem/restful-security-service',
                code: 'SMART-on-FHIR',
              },
            ],
          },
        ],
      },
      resource: [{ type: 'Patient' }],
    },
  ],
};

/** A full token response: access + refresh + patient context + a granted `offline_access` scope. */
export const tokenResponseFull = {
  access_token: 'AT-full-token-abc123',
  token_type: 'Bearer',
  expires_in: 3600,
  scope:
    'patient/Condition.read patient/FamilyMemberHistory.read patient/Patient.read offline_access',
  refresh_token: 'RT-refresh-token-xyz789',
  patient: 'pat-1',
  id_token: 'eyJhbGciOiJSUzI1NiJ9.fake-epic-id-token.sig',
};

/** Epic-shaped access-only response: no `refresh_token` because `offline_access` was not
 * granted — the graceful-degrade case a `stayConnected` UI must handle without crashing. */
export const tokenResponseAccessOnly = {
  access_token: 'AT-epic-access-only-456',
  token_type: 'Bearer',
  expires_in: 3600,
  scope: 'patient/Condition.read patient/FamilyMemberHistory.read patient/Patient.read',
  patient: 'pat-1',
};
