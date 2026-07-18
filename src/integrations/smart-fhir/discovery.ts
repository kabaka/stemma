/**
 * Pure parsers + URL builders for SMART-on-FHIR endpoint discovery. A conformant server publishes
 * its OAuth endpoints two ways: the preferred `.well-known/smart-configuration` document, and the
 * legacy `CapabilityStatement` (`/metadata`) `oauth-uris` extension fallback (servers predating the
 * well-known endpoint). Both parsers are strict — a missing `authorization_endpoint`/`token_endpoint`
 * (or `authorize`/`token` oauth-uri) throws a descriptive error rather than returning a half-built
 * config that would silently misdirect the authorization request.
 *
 * Layering & purity: no network here (the transport lives in `gateway.ts`); these are pure,
 * total functions over already-fetched JSON, importing nothing outside `@/domain` (needs none).
 */

export interface SmartEndpoints {
  authorizeEndpoint: string;
  tokenEndpoint: string;
  capabilities?: string[];
  scopesSupported?: string[];
  codeChallengeMethods?: string[];
}

/** The canonical SMART "OAuth URIs" CapabilityStatement extension URL. */
const OAUTH_URIS_EXTENSION_URL =
  'http://fhir-registry.smarthealthit.org/StructureDefinition/oauth-uris';

/** Strip a single trailing slash so path joins never produce a double slash. */
function trimTrailingSlash(base: string): string {
  return base.replace(/\/+$/, '');
}

/** The `.well-known/smart-configuration` URL for a FHIR base (trailing-slash tolerant). */
export function smartConfigurationUrl(fhirBaseUrl: string): string {
  return `${trimTrailingSlash(fhirBaseUrl)}/.well-known/smart-configuration`;
}

/** The CapabilityStatement (`/metadata`) URL for a FHIR base (trailing-slash tolerant). */
export function metadataUrl(fhirBaseUrl: string): string {
  return `${trimTrailingSlash(fhirBaseUrl)}/metadata`;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function asStringArray(v: unknown): string[] | undefined {
  return Array.isArray(v) && v.every((x) => typeof x === 'string') ? v : undefined;
}

/**
 * Parse a `.well-known/smart-configuration` document into {@link SmartEndpoints}. Reads
 * `authorization_endpoint`, `token_endpoint`, `capabilities`, `scopes_supported`, and
 * `code_challenge_methods_supported`. Throws when either required endpoint is absent or the input
 * is not an object.
 */
export function parseSmartConfiguration(json: unknown): SmartEndpoints {
  if (!isObject(json)) {
    throw new Error('SMART configuration is not a JSON object.');
  }
  const authorizeEndpoint = json.authorization_endpoint;
  const tokenEndpoint = json.token_endpoint;
  if (typeof authorizeEndpoint !== 'string' || !authorizeEndpoint) {
    throw new Error('SMART configuration is missing an authorization_endpoint.');
  }
  if (typeof tokenEndpoint !== 'string' || !tokenEndpoint) {
    throw new Error('SMART configuration is missing a token_endpoint.');
  }
  return {
    authorizeEndpoint,
    tokenEndpoint,
    capabilities: asStringArray(json.capabilities),
    scopesSupported: asStringArray(json.scopes_supported),
    codeChallengeMethods: asStringArray(json.code_challenge_methods_supported),
  };
}

/**
 * Parse a `CapabilityStatement`'s `rest[].security.extension` `oauth-uris` fallback into
 * {@link SmartEndpoints}. Walks every `rest` entry's security extensions for the `oauth-uris`
 * extension, then its `authorize`/`token` sub-extensions. Throws a descriptive error when no
 * `oauth-uris` extension (or its required sub-URIs) is present.
 */
export function parseCapabilityStatementOAuth(cs: unknown): SmartEndpoints {
  if (!isObject(cs)) {
    throw new Error('CapabilityStatement is not a JSON object.');
  }
  const rest = Array.isArray(cs.rest) ? cs.rest : [];
  if (rest.length === 0) {
    throw new Error('CapabilityStatement has no rest entries to read OAuth URIs from.');
  }

  for (const entry of rest) {
    if (!isObject(entry)) continue;
    const security = isObject(entry.security) ? entry.security : undefined;
    const extensions = security && Array.isArray(security.extension) ? security.extension : [];
    const oauthExt = extensions.find(
      (e) =>
        isObject(e) &&
        (e.url === OAUTH_URIS_EXTENSION_URL ||
          (typeof e.url === 'string' && e.url.endsWith('oauth-uris'))),
    );
    if (!isObject(oauthExt) || !Array.isArray(oauthExt.extension)) continue;

    let authorizeEndpoint: string | undefined;
    let tokenEndpoint: string | undefined;
    for (const sub of oauthExt.extension) {
      if (!isObject(sub)) continue;
      if (sub.url === 'authorize' && typeof sub.valueUri === 'string')
        authorizeEndpoint = sub.valueUri;
      if (sub.url === 'token' && typeof sub.valueUri === 'string') tokenEndpoint = sub.valueUri;
    }
    if (authorizeEndpoint && tokenEndpoint) {
      return { authorizeEndpoint, tokenEndpoint };
    }
  }

  throw new Error(
    'CapabilityStatement carries no SMART oauth-uris extension with both authorize and token URIs.',
  );
}
