/**
 * Scope selection for the authorization request.
 *
 * Stemma asks for a broad set of `patient/<Resource>.read` scopes (see `BASE_SCOPES` in the
 * connection store). Some SMART servers reject an authorization request that names a resource
 * scope they don't offer, so where a server tells us what it supports we trim the request down to
 * the intersection — but *only* when the server actually enumerates resource scopes.
 *
 * The subtlety this function exists to handle: a conformant server's
 * `.well-known/smart-configuration` `scopes_supported` is **not required to list resource scopes at
 * all**. Epic, for example, advertises only identity/launch scopes (`fhirUser`, `launch`, `openid`,
 * `profile`) and no `patient/*` scopes whatsoever. Naively intersecting against that list would
 * strip every patient-data scope and break the import. So:
 *
 * - If the server advertises **no** resource scopes, we can infer nothing about resource support
 *   and request the full set unchanged (the SMART spec has the server grant the subset it allows).
 * - If the server **does** enumerate resource scopes, we drop any requested `patient/<Resource>.read`
 *   whose `<context>/<Resource>` pair the server never mentions. Matching is on the **context and
 *   resource name** only, ignoring the `.read` / `.rs` access suffix, so a server advertising SMART
 *   v2 `patient/Observation.rs` still keeps our v1 `patient/Observation.read`. A `*` wildcard
 *   resource (`patient/*.rs`) means "all resources in that context". The context is kept in the key
 *   so a server that advertises only `user/Observation` never causes us to keep `patient/Observation`.
 *
 * This only ever **reduces** the requested scopes; it never adds or rewrites one. Identity/launch
 * scopes (`openid`, `fhirUser`, `profile`, `launch`, `launch/patient`, `offline_access`, …) are
 * always kept — servers vary in whether they enumerate them, and dropping them would break sign-in.
 *
 * Pure; no I/O. Imports nothing outside the module.
 */

/**
 * Matches a resource scope like `patient/Observation.read` → captures the context (`patient` /
 * `user` / `system`) and the resource name (`Observation`, or `*` for a context wildcard).
 */
const RESOURCE_SCOPE_RE = /^(patient|user|system)\/([^./]+)\./;

/** Key a resource scope by `<context>/<resource>`, discarding the `.read` / `.rs` access suffix. */
function resourceKey(context: string, resource: string): string {
  return `${context}/${resource}`;
}

/**
 * Trim `requested` scopes to what `supported` (the server's advertised `scopes_supported`) implies,
 * per the rules above. Returns a new array; never mutates. Order is preserved.
 */
export function selectScopes(requested: string[], supported?: string[]): string[] {
  if (!supported || supported.length === 0) return [...requested];

  // Resource scopes the server advertises, keyed by `<context>/<resource>`; plus the set of
  // contexts that advertise a `*` wildcard (all resources in that context).
  const supportedKeys = new Set<string>();
  const wildcardContexts = new Set<string>();
  for (const s of supported) {
    const m = RESOURCE_SCOPE_RE.exec(s);
    if (!m) continue;
    const [, context, resource] = m;
    if (resource === '*') wildcardContexts.add(context);
    else supportedKeys.add(resourceKey(context, resource));
  }

  // Server didn't enumerate any resource scopes (e.g. Epic lists only identity scopes) — we can't
  // infer resource support, so request everything and let the server grant the subset it allows.
  if (supportedKeys.size === 0 && wildcardContexts.size === 0) return [...requested];

  return requested.filter((scope) => {
    const m = RESOURCE_SCOPE_RE.exec(scope);
    if (!m) return true; // keep identity/launch and any non-resource scope
    const [, context, resource] = m;
    return wildcardContexts.has(context) || supportedKeys.has(resourceKey(context, resource));
  });
}
