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
    return Promise.resolve(route.response());
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
});
