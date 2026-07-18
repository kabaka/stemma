/**
 * Oracle for `src/integrations/smart-fhir/discovery.ts` — the pure parsers for the two ways a
 * SMART server publishes its OAuth endpoints: the `.well-known/smart-configuration` document
 * (preferred) and the `CapabilityStatement` `oauth-uris` extension fallback (`/metadata`).
 */
import { describe, expect, it } from 'vitest';
import {
  metadataUrl,
  parseCapabilityStatementOAuth,
  parseSmartConfiguration,
  smartConfigurationUrl,
} from './discovery';
import {
  capabilityStatementWithOAuthUris,
  capabilityStatementWithoutOAuthUris,
  wellKnownSmartConfig,
} from './fixtures';

describe('smartConfigurationUrl', () => {
  it('appends the well-known path to a base URL with no trailing slash', () => {
    expect(smartConfigurationUrl('https://ehr.example.org/fhir')).toBe(
      'https://ehr.example.org/fhir/.well-known/smart-configuration',
    );
  });

  it('is trailing-slash tolerant (never emits a double slash)', () => {
    expect(smartConfigurationUrl('https://ehr.example.org/fhir/')).toBe(
      'https://ehr.example.org/fhir/.well-known/smart-configuration',
    );
  });
});

describe('metadataUrl', () => {
  it('appends /metadata to a base URL with no trailing slash', () => {
    expect(metadataUrl('https://ehr.example.org/fhir')).toBe(
      'https://ehr.example.org/fhir/metadata',
    );
  });

  it('is trailing-slash tolerant (never emits a double slash)', () => {
    expect(metadataUrl('https://ehr.example.org/fhir/')).toBe(
      'https://ehr.example.org/fhir/metadata',
    );
  });
});

describe('parseSmartConfiguration', () => {
  it('reads authorization_endpoint, token_endpoint, capabilities, scopes_supported, code_challenge_methods_supported', () => {
    const endpoints = parseSmartConfiguration(wellKnownSmartConfig);
    expect(endpoints.authorizeEndpoint).toBe(wellKnownSmartConfig.authorization_endpoint);
    expect(endpoints.tokenEndpoint).toBe(wellKnownSmartConfig.token_endpoint);
    expect(endpoints.capabilities).toEqual(wellKnownSmartConfig.capabilities);
    expect(endpoints.scopesSupported).toEqual(wellKnownSmartConfig.scopes_supported);
    expect(endpoints.codeChallengeMethods).toEqual(
      wellKnownSmartConfig.code_challenge_methods_supported,
    );
  });

  it('throws a descriptive error when authorization_endpoint is missing', () => {
    expect(() => parseSmartConfiguration({ token_endpoint: 'https://x/token' })).toThrow(
      /authoriz/i,
    );
  });

  it('throws a descriptive error when token_endpoint is missing', () => {
    expect(() =>
      parseSmartConfiguration({ authorization_endpoint: 'https://x/authorize' }),
    ).toThrow(/token/i);
  });

  it('throws rather than crashing on non-object / hostile input', () => {
    expect(() => parseSmartConfiguration(null)).toThrow();
    expect(() => parseSmartConfiguration(undefined)).toThrow();
    expect(() => parseSmartConfiguration('not json')).toThrow();
    expect(() => parseSmartConfiguration(42)).toThrow();
    expect(() => parseSmartConfiguration({})).toThrow();
  });
});

describe('parseCapabilityStatementOAuth', () => {
  it('extracts authorize/token URIs from the rest[].security.extension oauth-uris fallback', () => {
    const endpoints = parseCapabilityStatementOAuth(capabilityStatementWithOAuthUris);
    expect(endpoints.authorizeEndpoint).toBe('https://ehr.example.org/oauth/authorize');
    expect(endpoints.tokenEndpoint).toBe('https://ehr.example.org/oauth/token');
  });

  it('throws a descriptive error when the CapabilityStatement carries no oauth-uris extension', () => {
    expect(() => parseCapabilityStatementOAuth(capabilityStatementWithoutOAuthUris)).toThrow(
      /oauth/i,
    );
  });

  it('throws on a CapabilityStatement with no rest entries at all', () => {
    expect(() =>
      parseCapabilityStatementOAuth({ resourceType: 'CapabilityStatement', rest: [] }),
    ).toThrow();
  });

  it('throws rather than crashing on non-object / hostile input', () => {
    expect(() => parseCapabilityStatementOAuth(null)).toThrow();
    expect(() => parseCapabilityStatementOAuth('not json')).toThrow();
    expect(() => parseCapabilityStatementOAuth({})).toThrow();
  });
});
