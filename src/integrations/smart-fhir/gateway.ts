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
    const entries: { resource?: unknown }[] = [];

    // Patient read (single resource, not a searchset).
    const patient = await this.getJson(`${base}/Patient/${id}`, accessToken);
    entries.push({ resource: patient });

    // Condition + FamilyMemberHistory searches, each paged to exhaustion.
    for (const resource of ['Condition', 'FamilyMemberHistory']) {
      entries.push(
        ...(await this.fetchSearchEntries(`${base}/${resource}?patient=${id}`, accessToken)),
      );
    }

    return { resourceType: 'Bundle', entry: entries };
  }

  /** Follow `Bundle.link[relation=next]` verbatim, accumulating every page's entries. */
  private async fetchSearchEntries(
    firstUrl: string,
    accessToken: string,
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
      nextUrl = next?.url;
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
