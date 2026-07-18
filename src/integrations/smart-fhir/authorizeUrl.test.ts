/**
 * Oracle for `src/integrations/smart-fhir/authorizeUrl.ts` — the pure SMART **standalone**
 * launch authorize-URL builder. Standalone launch (never EHR launch) is the only mode Stemma
 * supports (DR-0020: the app is not embedded in an EHR), so the absence of a `launch` param is
 * a safety-relevant assertion, not an incidental detail.
 */
import { describe, expect, it } from 'vitest';
import { buildAuthorizeUrl } from './authorizeUrl';
import type { AuthorizeParams } from './authorizeUrl';

// Values deliberately include characters (space, '&', '?') that MUST be percent-encoded for the
// URL to round-trip correctly — a builder using naive string concatenation would corrupt these.
const baseParams: AuthorizeParams = {
  authorizeEndpoint: 'https://ehr.example.org/oauth2/authorize',
  clientId: 'stemma-app & co',
  redirectUri: 'https://kabaka.github.io/stemma/?x=1',
  scope: 'patient/Condition.read patient/FamilyMemberHistory.read launch/patient offline_access',
  state: 'AQIDBAUGBwgJCgsMDQ4PEA',
  aud: 'https://ehr.example.org/fhir',
  codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
};

describe('buildAuthorizeUrl', () => {
  it('emits every required SMART standalone-launch query parameter, correctly encoded', () => {
    const url = new URL(buildAuthorizeUrl(baseParams));
    expect(url.origin + url.pathname).toBe(baseParams.authorizeEndpoint);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe(baseParams.clientId);
    expect(url.searchParams.get('redirect_uri')).toBe(baseParams.redirectUri);
    expect(url.searchParams.get('scope')).toBe(baseParams.scope);
    expect(url.searchParams.get('state')).toBe(baseParams.state);
    expect(url.searchParams.get('aud')).toBe(baseParams.aud);
    expect(url.searchParams.get('code_challenge')).toBe(baseParams.codeChallenge);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('never includes a "launch" parameter (standalone launch, not EHR launch)', () => {
    const url = new URL(buildAuthorizeUrl(baseParams));
    expect(url.searchParams.has('launch')).toBe(false);
  });

  it('sets aud to exactly the FHIR base URL passed in, distinct from the authorize endpoint', () => {
    const url = new URL(buildAuthorizeUrl(baseParams));
    expect(url.searchParams.get('aud')).toBe('https://ehr.example.org/fhir');
    expect(url.searchParams.get('aud')).not.toBe(baseParams.authorizeEndpoint);
  });

  it('percent-encodes special characters so the raw client_id never leaks unescaped into the URL string', () => {
    const raw = buildAuthorizeUrl(baseParams);
    expect(raw).not.toContain('stemma-app & co');
    expect(raw).toContain(encodeURIComponent(baseParams.clientId));
  });

  it("preserves the redirect_uri's own query string through the round trip (never double-encoded/truncated)", () => {
    const url = new URL(buildAuthorizeUrl(baseParams));
    expect(url.searchParams.get('redirect_uri')).toBe('https://kabaka.github.io/stemma/?x=1');
  });

  it('always sets code_challenge_method to exactly "S256" (never "plain")', () => {
    const url = new URL(buildAuthorizeUrl(baseParams));
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });
});
