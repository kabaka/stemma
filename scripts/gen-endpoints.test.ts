import { describe, expect, it } from 'vitest';
// The pure transforms under test live in the generator script (network-free, clock-free).
import {
  decodeProviders,
  encodeProviders,
  mergeProviders,
  slimBrandsBundle,
  slimCernerBundle,
} from './gen-endpoints.mjs';

// A small hand-written Epic Brands bundle exercising every branch of the transform:
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
      source: 'epic',
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
      source: 'epic',
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

  it('tags every entry source: epic', () => {
    expect(providers.every((p) => p.source === 'epic')).toBe(true);
  });

  it('produces a deterministic, fully-specified sorted result', () => {
    // Beta Clinic survives only as the bare endpoint entry (no org added location).
    expect(providers).toEqual([
      {
        name: 'Alpha Health',
        fhirBaseUrl: 'https://alpha.example.org/fhir/r4',
        city: 'Austin',
        state: 'TX',
        source: 'epic',
      },
      { name: 'Beta Clinic', fhirBaseUrl: 'https://beta.example.org/fhir/r4', source: 'epic' },
      {
        name: 'Gamma Medical',
        fhirBaseUrl: 'https://beta.example.org/fhir/r4',
        city: 'Boston',
        state: 'MA',
        source: 'epic',
      },
    ]);
  });
});

// A small hand-written Cerner Ignite bundle (1:1 paired Organization + Endpoint):
//  - a production org (Cortland) with an `Endpoint/<id>` ref and city/state → kept;
//  - a sandbox org whose endpoint address carries the public sandbox tenant → dropped;
//  - a falsy-name org → dropped;
//  - an org whose endpoint ref dangles → excluded.
const cernerBundle = {
  resourceType: 'Bundle',
  entry: [
    {
      resource: {
        resourceType: 'Endpoint',
        id: 'c-ep-cortland',
        name: 'Cortland',
        address: 'https://fhir-myrecord.cerner.com/r4/cortland-tenant/',
      },
    },
    {
      resource: {
        resourceType: 'Endpoint',
        id: 'c-ep-sandbox',
        name: 'Sandbox',
        address: 'https://fhir-myrecord.cerner.com/r4/ec2458f2-1e24-41c8-b71b-0e701af7583d/',
      },
    },
    {
      resource: {
        resourceType: 'Organization',
        id: 'c-org-cortland',
        name: 'Cortland Regional Medical Center',
        address: [{ city: 'Cortland', state: 'NY' }],
        endpoint: [{ reference: 'Endpoint/c-ep-cortland' }],
      },
    },
    {
      resource: {
        resourceType: 'Organization',
        id: 'c-org-sandbox',
        name: 'Public Sandbox Hospital',
        address: [{ city: 'Kansas City', state: 'MO' }],
        endpoint: [{ reference: 'Endpoint/c-ep-sandbox' }],
      },
    },
    {
      resource: {
        resourceType: 'Organization',
        id: 'c-org-empty-name',
        name: '',
        endpoint: [{ reference: 'Endpoint/c-ep-cortland' }],
      },
    },
    {
      resource: {
        resourceType: 'Organization',
        id: 'c-org-dangling',
        name: 'Dangling Clinic',
        endpoint: [{ reference: 'Endpoint/c-ep-missing' }],
      },
    },
  ],
};

describe('slimCernerBundle', () => {
  const providers = slimCernerBundle(cernerBundle);

  it('emits a production org tagged source: cerner with city/state carried', () => {
    expect(providers).toContainEqual({
      name: 'Cortland Regional Medical Center',
      fhirBaseUrl: 'https://fhir-myrecord.cerner.com/r4/cortland-tenant/',
      city: 'Cortland',
      state: 'NY',
      source: 'cerner',
    });
  });

  it('excludes the public sandbox tenant', () => {
    expect(providers.some((p) => p.name === 'Public Sandbox Hospital')).toBe(false);
    expect(
      providers.some((p) => p.fhirBaseUrl.includes('ec2458f2-1e24-41c8-b71b-0e701af7583d')),
    ).toBe(false);
  });

  it('drops entries with a falsy name', () => {
    expect(providers.some((p) => p.name === '')).toBe(false);
  });

  it('excludes orgs whose endpoint reference does not resolve', () => {
    expect(providers.some((p) => p.name === 'Dangling Clinic')).toBe(false);
  });

  it('tags every entry source: cerner', () => {
    expect(providers.every((p) => p.source === 'cerner')).toBe(true);
  });
});

describe('mergeProviders', () => {
  const epic = slimBrandsBundle(bundle);
  const cerner = slimCernerBundle(cernerBundle);
  const merged = mergeProviders(epic, cerner);

  it('interleaves sources by name rather than blocking one vendor before the other', () => {
    // Alpha (epic), Beta (epic), Cortland (cerner), Gamma (epic) — Cortland sorts between
    // Beta and Gamma by name, proving the two sources interleave.
    expect(merged.map((p) => p.name)).toEqual([
      'Alpha Health',
      'Beta Clinic',
      'Cortland Regional Medical Center',
      'Gamma Medical',
    ]);
    expect(merged.map((p) => p.source)).toEqual(['epic', 'epic', 'cerner', 'epic']);
  });

  it('preserves the per-entry source through the merge', () => {
    const cortland = merged.find((p) => p.name === 'Cortland Regional Medical Center');
    expect(cortland?.source).toBe('cerner');
    const alpha = merged.find((p) => p.name === 'Alpha Health');
    expect(alpha?.source).toBe('epic');
  });
});

describe('encodeProviders / decodeProviders', () => {
  const providers = slimBrandsBundle(bundle);

  it('interns repeated URLs into the url table', () => {
    const { urls, rows } = encodeProviders(providers);
    // Alpha's URL and Beta's URL — Gamma reuses Beta's, so only two distinct URLs.
    expect(urls).toEqual(['https://alpha.example.org/fhir/r4', 'https://beta.example.org/fhir/r4']);
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

  it('encodes the source as a compact numeric code and decodes it back per entry', () => {
    const merged = mergeProviders(slimBrandsBundle(bundle), slimCernerBundle(cernerBundle));
    const { rows } = encodeProviders(merged);
    // Source code sits at row index 2: 0 = epic, 1 = cerner. Cortland (cerner) is row 2.
    expect(rows.map((row) => row[2])).toEqual([0, 0, 1, 0]);
    const decoded = decodeProviders(encodeProviders(merged));
    expect(decoded).toEqual(merged);
    expect(decoded.find((p) => p.name === 'Cortland Regional Medical Center')?.source).toBe(
      'cerner',
    );
  });
});
