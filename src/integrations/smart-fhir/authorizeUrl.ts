/**
 * The pure SMART **standalone**-launch authorize-URL builder. Stemma is never embedded in an EHR
 * (DR-0020), so it only ever performs a standalone launch: there is deliberately **no `launch`
 * parameter** and `aud` carries the FHIR base URL so the authorization server can bind the grant
 * to the right resource server. `code_challenge_method` is always `S256` (never `plain`).
 *
 * Purity & layering: no network, no DOM, no clock; imports nothing outside `@/domain` (and needs
 * none). Every value is percent-encoded via {@link encodeURIComponent} so special characters in
 * the `redirect_uri`, `client_id`, or `scope` round-trip without corrupting the query string.
 */

export interface AuthorizeParams {
  authorizeEndpoint: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
  /** MUST equal the FHIR base URL (SMART App Launch `aud`), distinct from the authorize endpoint. */
  aud: string;
  codeChallenge: string;
}

/**
 * Build the full authorization request URL. Emits `response_type=code`, `client_id`,
 * `redirect_uri`, `scope`, `state`, `aud`, `code_challenge`, and `code_challenge_method=S256` —
 * and never a `launch` parameter. Values are `encodeURIComponent`-escaped (space → `%20`, so a
 * client_id/scope with spaces or `&`/`?` cannot leak unescaped into the URL).
 */
export function buildAuthorizeUrl(p: AuthorizeParams): string {
  const params: Record<string, string> = {
    response_type: 'code',
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    scope: p.scope,
    state: p.state,
    aud: p.aud,
    code_challenge: p.codeChallenge,
    code_challenge_method: 'S256',
  };
  const query = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  return `${p.authorizeEndpoint}?${query}`;
}
