/**
 * Oracle for `src/integrations/smart-fhir/gateway.ts` — the impure OAuth/FHIR transport, always
 * exercised through an **injected `fetch` stub** (never a real network call; the CSP itself
 * forbids one outside the running app). The safety-critical assertions are: this is a **public**
 * OAuth client (RFC 8252 §8.5 / SMART App Launch) — no `client_secret` is ever sent, and no
 * `Authorization` header rides on the token-exchange calls themselves (that would only make
 * sense for a confidential client). `code_verifier` from PKCE is what authenticates the
 * exchange instead.
 */
import { describe, expect, it, vi } from 'vitest';
import { FetchSmartFhirGateway } from './gateway';
import type { SmartEndpoints } from './gateway';
import {
  capabilityStatementWithOAuthUris,
  tokenResponseAccessOnly,
  tokenResponseFull,
} from './fixtures';

const endpoints: SmartEndpoints = {
  authorizeEndpoint: 'https://ehr.example.org/oauth2/authorize',
  tokenEndpoint: 'https://ehr.example.org/oauth2/token',
};

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function headersToObject(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  const headers = h instanceof Headers ? h : new Headers(h);
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

/** A routed injected-`fetch` stub. Routes are tried in order; the first `match` wins. Every
 * call (URL, method, headers, body) is recorded for assertions — this is how the "no secret /
 * no auth header / form-encoded" safety properties get verified without a real network. */
function makeFetchStub(
  routes: { match: (url: string, method: string) => boolean; response: () => Response }[],
) {
  const calls: RecordedCall[] = [];
  const fetchStub = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    const method = init?.method ?? 'GET';
    const headers = headersToObject(init?.headers as HeadersInit | undefined);
    const body = typeof init?.body === 'string' ? init.body : undefined;
    calls.push({ url, method, headers, body });
    const route = routes.find((r) => r.match(url, method));
    if (!route) return Promise.reject(new Error(`Unexpected fetch: ${method} ${url}`));
    // A route's `response()` may throw to simulate a real network failure (e.g. a rejected fetch
    // promise, `ECONNRESET`) rather than only ever returning a non-OK `Response` — surface it the
    // same way a real `fetch()` would: a rejected promise, not a synchronous throw.
    try {
      return Promise.resolve(route.response());
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
  return { fetchStub, calls };
}

const exact = (url: string) => (u: string) => u === url;

describe('FetchSmartFhirGateway.exchangeCode', () => {
  it('POSTs a form-encoded body (grant_type=authorization_code, code, code_verifier, redirect_uri, client_id) with NO client_secret and NO Authorization header', async () => {
    const { fetchStub, calls } = makeFetchStub([
      { match: exact(endpoints.tokenEndpoint), response: () => jsonResponse(tokenResponseFull) },
    ]);
    const gateway = new FetchSmartFhirGateway(fetchStub as unknown as typeof fetch);

    const result = await gateway.exchangeCode(endpoints, {
      code: 'auth-code-123',
      redirectUri: 'https://kabaka.github.io/stemma/',
      codeVerifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
      clientId: 'stemma-app',
    });

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.method).toBe('POST');
    expect(call.headers['content-type']).toMatch(/application\/x-www-form-urlencoded/);
    expect(call.headers).not.toHaveProperty('authorization');

    const form = new URLSearchParams(call.body);
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code')).toBe('auth-code-123');
    expect(form.get('redirect_uri')).toBe('https://kabaka.github.io/stemma/');
    expect(form.get('code_verifier')).toBe('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');
    expect(form.get('client_id')).toBe('stemma-app');
    expect(form.has('client_secret')).toBe(false);

    expect(result).toEqual(tokenResponseFull);
  });
});

describe('FetchSmartFhirGateway.refresh', () => {
  it('POSTs grant_type=refresh_token with refresh_token + client_id, NO client_secret, NO Authorization header — and tolerates the Epic access-only response shape (no refresh_token back)', async () => {
    const { fetchStub, calls } = makeFetchStub([
      {
        match: exact(endpoints.tokenEndpoint),
        response: () => jsonResponse(tokenResponseAccessOnly),
      },
    ]);
    const gateway = new FetchSmartFhirGateway(fetchStub as unknown as typeof fetch);

    const result = await gateway.refresh(endpoints, {
      refreshToken: 'RT-refresh-token-xyz789',
      clientId: 'stemma-app',
    });

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.method).toBe('POST');
    expect(call.headers['content-type']).toMatch(/application\/x-www-form-urlencoded/);
    expect(call.headers).not.toHaveProperty('authorization');

    const form = new URLSearchParams(call.body);
    expect(form.get('grant_type')).toBe('refresh_token');
    expect(form.get('refresh_token')).toBe('RT-refresh-token-xyz789');
    expect(form.get('client_id')).toBe('stemma-app');
    expect(form.has('client_secret')).toBe(false);

    expect(result).toEqual(tokenResponseAccessOnly);
    expect(result.refresh_token).toBeUndefined();
  });
});

describe('FetchSmartFhirGateway.discover', () => {
  const fhirBaseUrl = 'https://ehr.example.org/fhir';
  const wellKnown = 'https://ehr.example.org/fhir/.well-known/smart-configuration';
  const metadata = 'https://ehr.example.org/fhir/metadata';

  it('uses .well-known/smart-configuration directly when it is available (single request)', async () => {
    const { fetchStub, calls } = makeFetchStub([
      {
        match: exact(wellKnown),
        response: () =>
          jsonResponse({
            authorization_endpoint: 'https://ehr.example.org/oauth2/authorize',
            token_endpoint: 'https://ehr.example.org/oauth2/token',
          }),
      },
      { match: exact(metadata), response: () => jsonResponse(capabilityStatementWithOAuthUris) },
    ]);
    const gateway = new FetchSmartFhirGateway(fetchStub as unknown as typeof fetch);

    const discovered = await gateway.discover(fhirBaseUrl);

    expect(discovered.authorizeEndpoint).toBe('https://ehr.example.org/oauth2/authorize');
    expect(discovered.tokenEndpoint).toBe('https://ehr.example.org/oauth2/token');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(wellKnown);
  });

  it('falls back to /metadata oauth-uris when .well-known returns a non-OK (404) status', async () => {
    const { fetchStub, calls } = makeFetchStub([
      { match: exact(wellKnown), response: () => jsonResponse({ error: 'not found' }, 404) },
      { match: exact(metadata), response: () => jsonResponse(capabilityStatementWithOAuthUris) },
    ]);
    const gateway = new FetchSmartFhirGateway(fetchStub as unknown as typeof fetch);

    const discovered = await gateway.discover(fhirBaseUrl);

    expect(discovered.authorizeEndpoint).toBe('https://ehr.example.org/oauth/authorize');
    expect(discovered.tokenEndpoint).toBe('https://ehr.example.org/oauth/token');
    // Both endpoints must actually have been tried, well-known first.
    expect(calls.map((c) => c.url)).toEqual([wellKnown, metadata]);
  });
});

describe('FetchSmartFhirGateway.fetchPatientData', () => {
  const fhirBaseUrl = 'https://ehr.example.org/fhir';
  const patientId = 'pat-1';
  const accessToken = 'AT-secret-token';

  const patientResource = { resourceType: 'Patient', id: patientId, birthDate: '1988-06-15' };
  const conditionA = {
    resourceType: 'Condition',
    id: 'cond-a',
    subject: { reference: `Patient/${patientId}` },
  };
  const conditionB = {
    resourceType: 'Condition',
    id: 'cond-b',
    subject: { reference: `Patient/${patientId}` },
  };
  const fmhA = {
    resourceType: 'FamilyMemberHistory',
    id: 'fmh-a',
    status: 'completed',
    patient: { reference: `Patient/${patientId}` },
  };
  // A real FHIR server hands back an arbitrary opaque "next" link; the client must follow it
  // verbatim rather than reconstruct its own page-2 URL.
  const nextPageUrl = `${fhirBaseUrl}/Condition?patient=${patientId}&page=2&_cursor=opaque-abc123`;

  it('follows Bundle.link[rel=next] pagination and assembles Patient + every Condition + FamilyMemberHistory page into one bundle, each GET bearing the token and FHIR Accept header', async () => {
    const { fetchStub, calls } = makeFetchStub([
      {
        match: (u) =>
          u.includes('/Condition') && u.includes(`patient=${patientId}`) && !u.includes('page=2'),
        response: () =>
          jsonResponse({
            resourceType: 'Bundle',
            type: 'searchset',
            entry: [{ resource: conditionA }],
            link: [{ relation: 'next', url: nextPageUrl }],
          }),
      },
      {
        match: exact(nextPageUrl),
        response: () =>
          jsonResponse({
            resourceType: 'Bundle',
            type: 'searchset',
            entry: [{ resource: conditionB }],
          }),
      },
      {
        match: (u) => u.includes('/FamilyMemberHistory') && u.includes(`patient=${patientId}`),
        response: () =>
          jsonResponse({ resourceType: 'Bundle', type: 'searchset', entry: [{ resource: fmhA }] }),
      },
      {
        match: (u) => u.endsWith(`/Patient/${patientId}`),
        response: () => jsonResponse(patientResource),
      },
    ]);
    const gateway = new FetchSmartFhirGateway(fetchStub as unknown as typeof fetch);

    const bundle = await gateway.fetchPatientData(fhirBaseUrl, patientId, accessToken);

    const resources = (bundle.entry ?? []).map(
      (e) => e.resource as { resourceType: string; id: string },
    );
    expect(resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ resourceType: 'Patient', id: patientId }),
        expect.objectContaining({ resourceType: 'Condition', id: 'cond-a' }),
        expect.objectContaining({ resourceType: 'Condition', id: 'cond-b' }),
        expect.objectContaining({ resourceType: 'FamilyMemberHistory', id: 'fmh-a' }),
      ]),
    );
    expect(resources).toHaveLength(4);

    // Pagination was genuinely followed — the second page's exact opaque URL was requested, not
    // just the first page silently truncated.
    expect(calls.some((c) => c.url === nextPageUrl)).toBe(true);

    // Every GET carries the bearer token and the FHIR JSON Accept header — never a bare fetch.
    expect(calls.length).toBeGreaterThanOrEqual(4);
    for (const call of calls) {
      expect(call.method).toBe('GET');
      expect(call.headers['authorization']).toBe(`Bearer ${accessToken}`);
      expect(call.headers['accept']).toMatch(/application\/fhir\+json/);
    }
  });

  it('stops pagination and NEVER sends the bearer token to a "next" link whose origin differs from the FHIR base (token-leak hardening)', async () => {
    // A malformed or compromised server naming an off-origin "next" link must not be able to
    // harvest the live access token by having the client blindly follow it.
    const crossOriginNext = 'https://evil.example.net/Condition?patient=pat-1&page=2';
    const { fetchStub, calls } = makeFetchStub([
      {
        match: (u) => u.includes('/Condition') && u.includes(`patient=${patientId}`),
        response: () =>
          jsonResponse({
            resourceType: 'Bundle',
            type: 'searchset',
            entry: [{ resource: conditionA }],
            link: [{ relation: 'next', url: crossOriginNext }],
          }),
      },
      {
        match: (u) => u.includes('/FamilyMemberHistory') && u.includes(`patient=${patientId}`),
        response: () =>
          jsonResponse({ resourceType: 'Bundle', type: 'searchset', entry: [{ resource: fmhA }] }),
      },
      {
        match: (u) => u.endsWith(`/Patient/${patientId}`),
        response: () => jsonResponse(patientResource),
      },
      // Deliberately NO route for the cross-origin URL: if the implementation ever calls fetch
      // with it, the stub throws "Unexpected fetch" and this test fails loudly.
    ]);
    const gateway = new FetchSmartFhirGateway(fetchStub as unknown as typeof fetch);

    const bundle = await gateway.fetchPatientData(fhirBaseUrl, patientId, accessToken);

    expect(calls.some((c) => c.url === crossOriginNext)).toBe(false);
    // Compare parsed origins (not a substring/prefix, which a crafted host could satisfy): no
    // request left for the attacker's origin at all.
    expect(calls.some((c) => new URL(c.url).origin === 'https://evil.example.net')).toBe(false);
    // Pagination stopped at the cross-origin hop — only the first Condition page's entry made it
    // through, never a fabricated second page.
    const conditionEntries = (bundle.entry ?? [])
      .map((e) => e.resource as { resourceType: string })
      .filter((r) => r.resourceType === 'Condition');
    expect(conditionEntries).toHaveLength(1);
  });
});

/**
 * Wave 4 (Gateway) — the full-timeline resource set, `_include` on medication searches, and
 * per-search failure isolation. See `../../../../docs` design records DR-0023/DR-0024 and the
 * canonical W4 contract. `fetchPatientData` does not yet implement any of this — these tests are
 * RED against the current (Condition + FamilyMemberHistory only) implementation, and are the
 * fixed oracle W4 must turn green without being edited to fit whatever gets built.
 */
describe('FetchSmartFhirGateway.fetchPatientData — full-timeline resource set (W4)', () => {
  const fhirBaseUrl = 'https://ehr.example.org/fhir';
  const patientId = 'pat-w4';
  const accessToken = 'AT-w4-secret-token';
  const patientResource = { resourceType: 'Patient', id: patientId, birthDate: '1975-01-01' };

  function emptyBundle(): { resourceType: 'Bundle'; type: string; entry: unknown[] } {
    return { resourceType: 'Bundle', type: 'searchset', entry: [] };
  }

  function urlOf(u: string): URL | null {
    try {
      return new URL(u);
    } catch {
      return null;
    }
  }

  /** Matches a GET search whose path ends `/ResourceType` and whose query carries every given
   * param (order-independent — robust to however the implementation assembles the query string,
   * e.g. `?patient=x&category=laboratory` vs `?category=laboratory&patient=x`). */
  function search(resourceType: string, params: Record<string, string> = {}) {
    return (u: string, method: string) => {
      if (method !== 'GET') return false;
      const parsed = urlOf(u);
      if (!parsed || !parsed.pathname.endsWith(`/${resourceType}`)) return false;
      return Object.entries(params).every(([k, v]) => parsed.searchParams.get(k) === v);
    };
  }

  interface RouteSpec {
    resourceType: string;
    /** Extra query params beyond the always-required `patient=<id>`. */
    params?: Record<string, string>;
    response: () => Response;
  }

  /** The full W4 search list (Condition/FamilyMemberHistory are pre-existing; the rest are new).
   * Each defaults to an empty searchset so a test only needs to override the one(s) it cares about. */
  function defaultRouteSpecs(): RouteSpec[] {
    return [
      { resourceType: 'Condition', response: () => jsonResponse(emptyBundle()) },
      { resourceType: 'FamilyMemberHistory', response: () => jsonResponse(emptyBundle()) },
      {
        resourceType: 'MedicationStatement',
        params: { _include: 'MedicationStatement:medication' },
        response: () => jsonResponse(emptyBundle()),
      },
      {
        resourceType: 'MedicationRequest',
        params: { _include: 'MedicationRequest:medication' },
        response: () => jsonResponse(emptyBundle()),
      },
      {
        resourceType: 'Observation',
        params: { category: 'laboratory' },
        response: () => jsonResponse(emptyBundle()),
      },
      {
        resourceType: 'Observation',
        params: { category: 'vital-signs' },
        response: () => jsonResponse(emptyBundle()),
      },
      { resourceType: 'Immunization', response: () => jsonResponse(emptyBundle()) },
      { resourceType: 'AllergyIntolerance', response: () => jsonResponse(emptyBundle()) },
      { resourceType: 'Procedure', response: () => jsonResponse(emptyBundle()) },
      { resourceType: 'Encounter', response: () => jsonResponse(emptyBundle()) },
    ];
  }

  /** Turns route specs (+ the mandatory Patient read) into `makeFetchStub` routes, requiring
   * `patient=<id>` on every search regardless of the spec's own extra params. */
  function routesFromSpecs(specs: RouteSpec[], patientRoute?: { response: () => Response }) {
    return [
      {
        match: (u: string) => u.endsWith(`/Patient/${patientId}`),
        response: patientRoute?.response ?? (() => jsonResponse(patientResource)),
      },
      ...specs.map((s) => ({
        match: search(s.resourceType, { patient: patientId, ...s.params }),
        response: s.response,
      })),
    ];
  }

  it('searches every W4 resource type (Condition, FamilyMemberHistory, MedicationStatement, MedicationRequest, Observation×2 categories, Immunization, AllergyIntolerance, Procedure, Encounter), each patient-scoped and the two Observation searches carrying their category param', async () => {
    const specs = defaultRouteSpecs();
    const { fetchStub, calls } = makeFetchStub(routesFromSpecs(specs));
    const gateway = new FetchSmartFhirGateway(fetchStub as unknown as typeof fetch);

    await gateway.fetchPatientData(fhirBaseUrl, patientId, accessToken);

    for (const s of specs) {
      const matcher = search(s.resourceType, { patient: patientId, ...s.params });
      const matched = calls.some((c) => matcher(c.url, c.method));
      expect(
        matched,
        `expected a ${s.resourceType} search with params ${JSON.stringify({ patient: patientId, ...s.params })}; got calls: ${calls.map((c) => c.url).join(', ')}`,
      ).toBe(true);
    }
  });

  it('requests _include=MedicationRequest:medication / _include=MedicationStatement:medication, and an `_include`d Medication resource lands in the assembled bundle', async () => {
    const medResource = {
      resourceType: 'Medication',
      id: 'med-1',
      code: { text: 'Lisinopril 10mg' },
    };
    const medicationRequest = {
      resourceType: 'MedicationRequest',
      id: 'mr-1',
      status: 'active',
      medicationReference: { reference: 'Medication/med-1' },
      authoredOn: '2020-05-01',
    };

    const specs = defaultRouteSpecs().map((s) =>
      s.resourceType === 'MedicationRequest'
        ? {
            ...s,
            response: () =>
              jsonResponse({
                resourceType: 'Bundle',
                type: 'searchset',
                entry: [{ resource: medicationRequest }, { resource: medResource }],
              }),
          }
        : s,
    );
    const { fetchStub, calls } = makeFetchStub(routesFromSpecs(specs));
    const gateway = new FetchSmartFhirGateway(fetchStub as unknown as typeof fetch);

    const bundle = await gateway.fetchPatientData(fhirBaseUrl, patientId, accessToken);

    // The searches themselves carried the _include param — a strict route match, not a loose
    // substring: if the implementation omitted `_include`, no route would have matched and the
    // stub would have rejected with "Unexpected fetch", failing this test loudly.
    expect(
      calls.some((c) =>
        search('MedicationRequest', {
          patient: patientId,
          _include: 'MedicationRequest:medication',
        })(c.url, c.method),
      ),
    ).toBe(true);
    expect(
      calls.some((c) =>
        search('MedicationStatement', {
          patient: patientId,
          _include: 'MedicationStatement:medication',
        })(c.url, c.method),
      ),
    ).toBe(true);

    const resources = (bundle.entry ?? []).map(
      (e) => e.resource as { resourceType: string; id: string },
    );
    expect(resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ resourceType: 'MedicationRequest', id: 'mr-1' }),
        expect.objectContaining({ resourceType: 'Medication', id: 'med-1' }),
      ]),
    );
  });

  it("one failing search (Encounter) does not abort the others — every other resource's entries still land, and a fetchWarnings entry names the failed resource", async () => {
    const conditionA = {
      resourceType: 'Condition',
      id: 'cond-w4',
      subject: { reference: `Patient/${patientId}` },
    };
    const allergyA = {
      resourceType: 'AllergyIntolerance',
      id: 'allergy-w4',
      verificationStatus: {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification',
            code: 'confirmed',
          },
        ],
      },
      onsetDateTime: '2015-01-01',
    };

    const specs = defaultRouteSpecs().map((s) => {
      if (s.resourceType === 'Condition') {
        return {
          ...s,
          response: () =>
            jsonResponse({
              resourceType: 'Bundle',
              type: 'searchset',
              entry: [{ resource: conditionA }],
            }),
        };
      }
      if (s.resourceType === 'AllergyIntolerance') {
        return {
          ...s,
          response: () =>
            jsonResponse({
              resourceType: 'Bundle',
              type: 'searchset',
              entry: [{ resource: allergyA }],
            }),
        };
      }
      if (s.resourceType === 'Encounter') {
        return {
          ...s,
          response: () => {
            // Simulates a real fetch() rejection (e.g. ECONNRESET) — see the makeFetchStub
            // try/catch above, which turns a thrown error into a rejected fetch promise.
            throw new Error('ECONNRESET');
          },
        };
      }
      return s;
    });

    const { fetchStub } = makeFetchStub(routesFromSpecs(specs));
    const gateway = new FetchSmartFhirGateway(fetchStub as unknown as typeof fetch);

    // The key W4 behavior: fetchPatientData still RESOLVES despite the Encounter search failing.
    const bundle = await gateway.fetchPatientData(fhirBaseUrl, patientId, accessToken);

    const resourceTypes = (bundle.entry ?? [])
      .map((e) => (e.resource as { resourceType?: string } | undefined)?.resourceType)
      .filter((t): t is string => t != null);
    expect(resourceTypes).toContain('Patient');
    expect(resourceTypes).toContain('Condition');
    expect(resourceTypes).toContain('AllergyIntolerance');
    // The failed resource contributed no entries (it wasn't silently retried into a fake success).
    expect(resourceTypes).not.toContain('Encounter');

    expect(bundle.fetchWarnings).toBeDefined();
    const warnings = bundle.fetchWarnings ?? [];
    expect(warnings.some((w) => /encounter|visit/i.test(w))).toBe(true);
    // Security (contract §W4 SECURITY): a fetchWarnings string carries only the label + err.message
    // — never the bearer token, a response body, or a header.
    for (const w of warnings) {
      expect(w).not.toContain(accessToken);
    }
  });

  it('multiple failing searches (Encounter throws, Procedure returns 500) each produce their own fetchWarnings entry — still no early abort', async () => {
    const specs = defaultRouteSpecs().map((s) => {
      if (s.resourceType === 'Encounter') {
        return {
          ...s,
          response: () => {
            throw new Error('timeout');
          },
        };
      }
      if (s.resourceType === 'Procedure') {
        return { ...s, response: () => jsonResponse({ issue: 'internal error' }, 500) };
      }
      return s;
    });

    const { fetchStub } = makeFetchStub(routesFromSpecs(specs));
    const gateway = new FetchSmartFhirGateway(fetchStub as unknown as typeof fetch);

    const bundle = await gateway.fetchPatientData(fhirBaseUrl, patientId, accessToken);

    const warnings = bundle.fetchWarnings ?? [];
    expect(warnings.length).toBeGreaterThanOrEqual(2);
    expect(warnings.some((w) => /encounter|visit/i.test(w))).toBe(true);
    expect(warnings.some((w) => /procedure/i.test(w))).toBe(true);
  });

  it('still throws when the mandatory Patient read fails — never swallowed into a fetchWarnings entry', async () => {
    const specs = defaultRouteSpecs();
    const routes = routesFromSpecs(specs, {
      response: () => jsonResponse({ issue: 'not found' }, 404),
    });
    const { fetchStub } = makeFetchStub(routes);
    const gateway = new FetchSmartFhirGateway(fetchStub as unknown as typeof fetch);

    await expect(gateway.fetchPatientData(fhirBaseUrl, patientId, accessToken)).rejects.toThrow();
  });

  it('applies the same-origin token guard to the new W4 searches too — a cross-origin Bundle.link[next] on an Immunization search is not followed and the bearer token is never sent off-origin', async () => {
    const crossOriginNext = `https://evil.example.net/Immunization?patient=${patientId}&page=2`;
    const immunizationA = {
      resourceType: 'Immunization',
      id: 'imm-w4',
      status: 'completed',
      occurrenceDateTime: '2020-01-01',
      vaccineCode: { coding: [{ system: 'http://hl7.org/fhir/sid/cvx', code: '08' }] },
    };

    const specs = defaultRouteSpecs().map((s) =>
      s.resourceType === 'Immunization'
        ? {
            ...s,
            response: () =>
              jsonResponse({
                resourceType: 'Bundle',
                type: 'searchset',
                entry: [{ resource: immunizationA }],
                link: [{ relation: 'next', url: crossOriginNext }],
              }),
          }
        : s,
    );
    // Deliberately NO route for the cross-origin URL: if the implementation ever calls fetch with
    // it, the stub rejects with "Unexpected fetch" — caught by the per-search try/catch (W4) and
    // surfaced as a warning rather than a crash, so we assert directly on `calls` below instead of
    // relying on an uncaught rejection to fail the test.
    const { fetchStub, calls } = makeFetchStub(routesFromSpecs(specs));
    const gateway = new FetchSmartFhirGateway(fetchStub as unknown as typeof fetch);

    const bundle = await gateway.fetchPatientData(fhirBaseUrl, patientId, accessToken);

    expect(calls.some((c) => c.url === crossOriginNext)).toBe(false);
    // Compare parsed origins (not a substring/prefix a crafted host could satisfy): no request
    // left for the attacker's origin at all.
    expect(calls.some((c) => urlOf(c.url)?.origin === 'https://evil.example.net')).toBe(false);
    const immunizationEntries = (bundle.entry ?? [])
      .map((e) => e.resource as { resourceType?: string })
      .filter((r) => r?.resourceType === 'Immunization');
    // Pagination stopped at the cross-origin hop — only the first page's entry made it through.
    expect(immunizationEntries).toHaveLength(1);
  });
});
