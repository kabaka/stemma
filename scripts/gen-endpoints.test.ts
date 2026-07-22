import { describe, expect, it } from 'vitest';
// The pure transform under test lives in the generator script (network-free, clock-free).
import { decodeProviders, encodeProviders, slimBrandsBundle } from './gen-endpoints.mjs';

// A small hand-written Brands bundle exercising every branch of the transform:
//  - 2 Endpoints with addresses (ep1, ep2);
//  - an Organization whose name+url duplicates ep1's endpoint entry but adds city/state
//    (dedup must keep ONE and prefer this location-bearing one) via a `urn:uuid:` ref;
//  - an Organization referencing ep2 via the plain `Endpoint/<id>` form, with city/state;
//  - an Organization with NO endpoint reference (must be excluded — brand-level only);
//  - an Organization with a falsy (empty) name (must be dropped);
//  - an Organization whose endpoint ref points at a missing Endpoint (must be excluded).
const bundle = {
  resourceType: 'Bundle',
  entry: [
    {
      resource: {
        resourceType: 'Endpoint',
        id: 'ep1',
        name: 'Alpha Health',
        address: 'https://alpha.example.org/fhir/r4',
      },
    },
    {
      resource: {
        resourceType: 'Endpoint',
        id: 'ep2',
        name: 'Beta Clinic',
        address: 'https://beta.example.org/fhir/r4',
      },
    },
    {
      resource: {
        resourceType: 'Organization',
        id: 'org-alpha',
        name: 'Alpha Health',
        address: [{ city: 'Austin', state: 'TX' }],
        endpoint: [{ reference: 'urn:uuid:ep1' }],
      },
    },
    {
      resource: {
        resourceType: 'Organization',
        id: 'org-gamma',
        name: 'Gamma Medical',
        address: [{ city: 'Boston', state: 'MA' }],
        endpoint: [{ reference: 'Endpoint/ep2' }],
      },
    },
    {
      resource: {
        resourceType: 'Organization',
        id: 'org-delta',
        name: 'Delta Care',
        address: [{ city: 'Denver', state: 'CO' }],
        // No endpoint reference — a facility org that must be excluded.
      },
    },
    {
      resource: {
        resourceType: 'Organization',
        id: 'org-empty-name',
        name: '',
        endpoint: [{ reference: 'urn:uuid:ep2' }],
      },
    },
    {
      resource: {
        resourceType: 'Organization',
        id: 'org-dangling',
        name: 'Zeta Group',
        endpoint: [{ reference: 'urn:uuid:does-not-exist' }],
      },
    },
  ],
};

describe('slimBrandsBundle', () => {
  const providers = slimBrandsBundle(bundle);

  it('dedups a colliding name+url to a single entry and prefers the location-bearing one', () => {
    const alphas = providers.filter((p) => p.name === 'Alpha Health');
    expect(alphas).toHaveLength(1);
    expect(alphas[0]).toEqual({
      name: 'Alpha Health',
      fhirBaseUrl: 'https://alpha.example.org/fhir/r4',
      city: 'Austin',
      state: 'TX',
    });
  });

  it('resolves urn:uuid: and plain Endpoint/<id> references', () => {
    // urn:uuid:ep1 resolved for Alpha (asserted above); Endpoint/ep2 resolves for Gamma.
    const gamma = providers.find((p) => p.name === 'Gamma Medical');
    expect(gamma).toEqual({
      name: 'Gamma Medical',
      fhirBaseUrl: 'https://beta.example.org/fhir/r4',
      city: 'Boston',
      state: 'MA',
    });
  });

  it('excludes orgs with no direct endpoint reference', () => {
    expect(providers.some((p) => p.name === 'Delta Care')).toBe(false);
  });

  it('excludes orgs whose endpoint reference does not resolve', () => {
    expect(providers.some((p) => p.name === 'Zeta Group')).toBe(false);
  });

  it('drops entries with a falsy name', () => {
    expect(providers.some((p) => p.name === '')).toBe(false);
  });

  it('produces a deterministic, fully-specified sorted result', () => {
    // Beta Clinic survives only as the bare endpoint entry (no org added location).
    expect(providers).toEqual([
      {
        name: 'Alpha Health',
        fhirBaseUrl: 'https://alpha.example.org/fhir/r4',
        city: 'Austin',
        state: 'TX',
      },
      { name: 'Beta Clinic', fhirBaseUrl: 'https://beta.example.org/fhir/r4' },
      {
        name: 'Gamma Medical',
        fhirBaseUrl: 'https://beta.example.org/fhir/r4',
        city: 'Boston',
        state: 'MA',
      },
    ]);
  });
});

describe('encodeProviders / decodeProviders', () => {
  const providers = slimBrandsBundle(bundle);

  it('interns repeated URLs into the url table', () => {
    const { urls, rows } = encodeProviders(providers);
    // Alpha's URL and Beta's URL — Gamma reuses Beta's, so only two distinct URLs.
    expect(urls).toEqual([
      'https://alpha.example.org/fhir/r4',
      'https://beta.example.org/fhir/r4',
    ]);
    // Beta Clinic and Gamma Medical both reference url index 1.
    expect(rows[1][1]).toBe(1);
    expect(rows[2][1]).toBe(1);
  });

  it('round-trips through the url-table decode with the right fhirBaseUrl per entry', () => {
    const decoded = decodeProviders(encodeProviders(providers));
    expect(decoded).toEqual(providers);
    // The shared-URL entry decodes to Beta's base URL, not Alpha's.
    const gamma = decoded.find((p) => p.name === 'Gamma Medical');
    expect(gamma?.fhirBaseUrl).toBe('https://beta.example.org/fhir/r4');
  });
});
