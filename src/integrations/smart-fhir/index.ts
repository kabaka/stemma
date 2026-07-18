/**
 * Public surface of the SMART-on-FHIR integration port — the impure OAuth/transport half of the
 * FHIR import feature (the pure FHIR → record mapper lives in `src/import/fhir.ts`).
 *
 * Layering: `src/integrations/smart-fhir/` may import only `@/domain` types and its own siblings;
 * never `store`, `ui`, `import`, or `export`. The store (`useSmartConnectionStore`) is the only
 * caller that drives these; the UI never sees a raw token.
 */
export { base64UrlEncode, computeCodeChallenge, generateCodeVerifier, generateState } from './pkce';

export { buildAuthorizeUrl } from './authorizeUrl';
export type { AuthorizeParams } from './authorizeUrl';

export {
  metadataUrl,
  parseCapabilityStatementOAuth,
  parseSmartConfiguration,
  smartConfigurationUrl,
} from './discovery';
export type { SmartEndpoints } from './discovery';

export { computeExpiresAtMs, isAccessTokenExpired } from './expiry';

export { FetchSmartFhirGateway } from './gateway';
export type { FhirImportBundle, SmartFhirGateway, TokenResponse } from './gateway';

export { BrowserTokenStore, defaultTokenStore } from './tokenStore';
export type { AccessTokenRecord, TokenStore } from './tokenStore';
