/**
 * The impure SMART-on-FHIR OAuth + FHIR transport. All I/O funnels through an **injected** `fetch`
 * (defaulting to `globalThis.fetch`) so it is fully stubbable — the tests never touch a real
 * network, and the app's own CSP forbids one outside the running page.
 *
 * Safety-critical properties (RFC 8252 §8.5 / SMART App Launch, DR-0020): Stemma is a **public**
 * OAuth client. The token-exchange and refresh calls send a form-encoded body with `client_id`
 * and `grant_type` but **never a `client_secret` and never an `Authorization` header** — the PKCE
 * `code_verifier` is what authenticates the exchange. All FHIR reads carry the bearer access token
 * and `Accept: application/fhir+json`, and search results are paged by following the server's own
 * opaque `Bundle.link[relation=next]` URL verbatim (never a client-reconstructed page URL).
 *
 * Layering: `src/integrations/smart-fhir/` — imports only sibling modules (`discovery`) and
 * `@/domain` types; never `store`, `ui`, `import`, or `export`.
 */
import { OBS_CATEGORY } from '@/data/fhir-codes';
import {
  metadataUrl,
  parseCapabilityStatementOAuth,
  parseSmartConfiguration,
  smartConfigurationUrl,
  type SmartEndpoints,
} from './discovery';

export type { SmartEndpoints } from './discovery';

/** The OAuth token endpoint response (RFC 6749 §5.1 + SMART launch context). `refresh_token` and
 * `patient` are optional — an Epic-style access-only grant (no `offline_access`) omits the former. */
export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
  refresh_token?: string;
  patient?: string;
  id_token?: string;
}

/** A minimal FHIR Bundle the pure {@link file://../../import/fhir.ts} parser consumes. */
export interface FhirImportBundle {
  resourceType: 'Bundle';
  entry?: { resource?: unknown }[];
  /**
   * Per-search retrieval failures, one human-readable line each ("Couldn't retrieve <label> from
   * this provider (<message>)."). A single search failing degrades to a warning rather than aborting
   * the whole sync (the mandatory Patient read still rejects). SECURITY (DR-0020 / contract §W4):
   * each string carries only the label + the error's `message` — never a URL with a token, a header,
   * or a response body. The parser merges these verbatim into `ParsedHealthRecord.warnings`.
   */
  fetchWarnings?: string[];
}

export interface SmartFhirGateway {
  discover(fhirBaseUrl: string): Promise<SmartEndpoints>;
  exchangeCode(
    endpoints: SmartEndpoints,
    p: { code: string; redirectUri: string; codeVerifier: string; clientId: string },
  ): Promise<TokenResponse>;
  refresh(
    endpoints: SmartEndpoints,
    p: { refreshToken: string; clientId: string },
  ): Promise<TokenResponse>;
  fetchPatientData(
    fhirBaseUrl: string,
    patientId: string,
    accessToken: string,
  ): Promise<FhirImportBundle>;
}

const FORM_CONTENT_TYPE = 'application/x-www-form-urlencoded';
const FHIR_ACCEPT = 'application/fhir+json';

/** A FHIR `Bundle.link` entry. */
interface BundleLink {
  relation?: string;
  url?: string;
}

/** Strip a single trailing slash so path joins never produce a double slash. */
function trimTrailingSlash(base: string): string {
  return base.replace(/\/+$/, '');
}

/** The origin of an (absolute) URL, or `null` if it can't be parsed. */
function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Whether `url`'s origin matches `baseOrigin`. Fails closed (false) if either is unparseable. */
function isSameOrigin(url: string, baseOrigin: string | null): boolean {
  if (baseOrigin === null) return false;
  const o = originOf(url);
  return o !== null && o === baseOrigin;
}

/** The `fetch` port implementation of {@link SmartFhirGateway}. */
export class FetchSmartFhirGateway implements SmartFhirGateway {
  private readonly fetchImpl: typeof fetch;

  constructor(fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)) {
    this.fetchImpl = fetchImpl;
  }

  async discover(fhirBaseUrl: string): Promise<SmartEndpoints> {
    // Prefer the well-known document; only if it is unavailable fall back to /metadata oauth-uris.
    const wellKnownRes = await this.fetchImpl(smartConfigurationUrl(fhirBaseUrl), {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (wellKnownRes.ok) {
      return parseSmartConfiguration(await wellKnownRes.json());
    }
    const metaRes = await this.fetchImpl(metadataUrl(fhirBaseUrl), {
      method: 'GET',
      headers: { Accept: FHIR_ACCEPT },
    });
    if (!metaRes.ok) {
      throw new Error(
        `SMART discovery failed: neither .well-known/smart-configuration nor /metadata was available (${metaRes.status}).`,
      );
    }
    return parseCapabilityStatementOAuth(await metaRes.json());
  }

  async exchangeCode(
    endpoints: SmartEndpoints,
    p: { code: string; redirectUri: string; codeVerifier: string; clientId: string },
  ): Promise<TokenResponse> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: p.code,
      redirect_uri: p.redirectUri,
      code_verifier: p.codeVerifier,
      client_id: p.clientId,
    });
    return this.postTokenRequest(endpoints.tokenEndpoint, body);
  }

  async refresh(
    endpoints: SmartEndpoints,
    p: { refreshToken: string; clientId: string },
  ): Promise<TokenResponse> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: p.refreshToken,
      client_id: p.clientId,
    });
    return this.postTokenRequest(endpoints.tokenEndpoint, body);
  }

  /** POST a form-encoded token request. Public client: no `client_secret`, no `Authorization`. */
  private async postTokenRequest(
    tokenEndpoint: string,
    body: URLSearchParams,
  ): Promise<TokenResponse> {
    const res = await this.fetchImpl(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': FORM_CONTENT_TYPE, Accept: 'application/json' },
      body: body.toString(),
    });
    if (!res.ok) {
      throw new Error(`Token request failed: ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as TokenResponse;
  }

  async fetchPatientData(
    fhirBaseUrl: string,
    patientId: string,
    accessToken: string,
  ): Promise<FhirImportBundle> {
    const base = trimTrailingSlash(fhirBaseUrl);
    const id = encodeURIComponent(patientId);
    // The origin the bearer token is scoped to. Pagination MUST stay same-origin — a malformed or
    // compromised server could name a cross-origin `next` link and harvest the live access token
    // (DR-0020). Derive it once from the discovered FHIR base URL and gate every `next` hop on it.
    const baseOrigin = originOf(base);
    const entries: { resource?: unknown }[] = [];

    // Patient read (single resource, not a searchset). This is MANDATORY: a failure rejects the
    // whole sync (never degraded into a warning) — without the proband there is nothing to import.
    const patient = await this.getJson(`${base}/Patient/${id}`, accessToken);
    entries.push({ resource: patient });

    // The full-timeline search set (DR-0023/DR-0024). Each entry is a first-page query URL plus a
    // human `label` used ONLY in a failure warning. The two medication searches request the
    // referenced Medication resources via `_include`; the two Observation searches carry their
    // `category` token (genomic Observations arrive via the laboratory search and are classified by
    // the parser — no separate genomic search). Every URL is same-origin with the discovered base,
    // so `fetchSearchEntries`' pagination + off-origin token guard applies to each unchanged.
    const searches: { query: string; label: string }[] = [
      { query: `${base}/Condition?patient=${id}`, label: 'conditions' },
      { query: `${base}/FamilyMemberHistory?patient=${id}`, label: 'family history' },
      {
        query: `${base}/MedicationStatement?patient=${id}&_include=MedicationStatement:medication`,
        label: 'medication statements',
      },
      {
        query: `${base}/MedicationRequest?patient=${id}&_include=MedicationRequest:medication`,
        label: 'medication requests',
      },
      {
        query: `${base}/Observation?patient=${id}&category=${OBS_CATEGORY.LAB}`,
        label: 'lab results',
      },
      {
        query: `${base}/Observation?patient=${id}&category=${OBS_CATEGORY.VITAL}`,
        label: 'vital signs',
      },
      { query: `${base}/Immunization?patient=${id}`, label: 'immunizations' },
      { query: `${base}/AllergyIntolerance?patient=${id}`, label: 'allergies' },
      { query: `${base}/Procedure?patient=${id}`, label: 'procedures' },
      { query: `${base}/Encounter?patient=${id}`, label: 'encounters' },
    ];

    // Run every search concurrently. Each is isolated: a failing search contributes no entries and a
    // single warning line instead of aborting the others. The warning carries ONLY the label and the
    // error `message` — never a URL (which would embed the patient id), a header, or a response body.
    const fetchWarnings: string[] = [];
    const results = await Promise.all(
      searches.map(async ({ query, label }) => {
        try {
          return await this.fetchSearchEntries(query, accessToken, baseOrigin);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          fetchWarnings.push(`Couldn't retrieve ${label} from this provider (${message}).`);
          return [] as { resource?: unknown }[];
        }
      }),
    );
    for (const searchEntries of results) entries.push(...searchEntries);

    const bundle: FhirImportBundle = { resourceType: 'Bundle', entry: entries };
    if (fetchWarnings.length > 0) bundle.fetchWarnings = fetchWarnings;
    return bundle;
  }

  /**
   * Follow `Bundle.link[relation=next]` verbatim, accumulating every page's entries. A `next` link
   * whose origin differs from the FHIR base URL's origin is NOT followed — the bearer token is never
   * sent cross-origin (token-leak hardening); pagination simply stops and a warning is logged.
   */
  private async fetchSearchEntries(
    firstUrl: string,
    accessToken: string,
    baseOrigin: string | null,
  ): Promise<{ resource?: unknown }[]> {
    const out: { resource?: unknown }[] = [];
    let nextUrl: string | undefined = firstUrl;
    // Bound the loop defensively against a server that returns a self-referential `next` link.
    let guard = 0;
    while (nextUrl && guard < 1000) {
      guard += 1;
      const bundle = (await this.getJson(nextUrl, accessToken)) as {
        entry?: { resource?: unknown }[];
        link?: BundleLink[];
      };
      if (Array.isArray(bundle.entry)) {
        for (const e of bundle.entry) out.push({ resource: e?.resource });
      }
      const next = Array.isArray(bundle.link)
        ? bundle.link.find((l) => l?.relation === 'next' && typeof l.url === 'string')
        : undefined;
      const candidate = next?.url;
      if (candidate && !isSameOrigin(candidate, baseOrigin)) {
        // Do NOT send the access token to a foreign origin. Stop paginating here.
        console.warn(
          `SMART pagination stopped: a "next" link pointed off-origin (${originOf(candidate) ?? 'unparseable'}); ` +
            `refusing to send the access token cross-origin from ${baseOrigin ?? 'unknown'}.`,
        );
        nextUrl = undefined;
      } else {
        nextUrl = candidate;
      }
    }
    return out;
  }

  /** GET a FHIR resource with the bearer token and FHIR Accept header. */
  private async getJson(url: string, accessToken: string): Promise<unknown> {
    const res = await this.fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}`, Accept: FHIR_ACCEPT },
    });
    if (!res.ok) {
      throw new Error(`FHIR read failed: ${res.status} ${res.statusText} for ${url}`);
    }
    return res.json();
  }
}
