/**
 * PKCE (RFC 7636, S256) helpers for the SMART-on-FHIR **standalone** launch authorization
 * request. PKCE is what authenticates Stemma's authorization-code exchange: as a browser-only
 * **public** client (no backend, no client secret — DR-0020) the `code_verifier`/`code_challenge`
 * pair, not a shared secret, is the anti-interception proof. `plain` is never used; only `S256`.
 *
 * Purity & determinism: every entropy/digest source is **injectable** so the whole module is
 * deterministic under test (never real randomness, never the wall clock). The production defaults
 * are Web Crypto (`crypto.getRandomValues` / `crypto.subtle`). No network, no storage, no DOM.
 *
 * Layering: `src/integrations/smart-fhir/` — may import only `@/domain` types. This file needs
 * none. It must never reach into `store`, `ui`, `import`, or `export`.
 */

/** base64url alphabet (RFC 4648 §5): url-safe, so no `+`/`/`/`=` ever appears in the output. */
const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * base64url-encode raw bytes with NO padding (`+`→`-`, `/`→`_`, trailing `=` stripped). Encodes
 * directly against the url-safe alphabet, so the result is transport-safe as a query parameter
 * with no post-processing.
 */
export function base64UrlEncode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const has1 = i + 1 < bytes.length;
    const has2 = i + 2 < bytes.length;
    const b1 = has1 ? bytes[i + 1] : 0;
    const b2 = has2 ? bytes[i + 2] : 0;
    out += B64URL[b0 >> 2];
    out += B64URL[((b0 & 0x03) << 4) | (b1 >> 4)];
    if (has1) out += B64URL[((b1 & 0x0f) << 2) | (b2 >> 6)];
    if (has2) out += B64URL[b2 & 0x3f];
  }
  return out;
}

/** Default randomness source: Web Crypto, requesting an `n`-byte buffer. */
const defaultRand = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n));

/**
 * A fresh PKCE `code_verifier`: base64url of 32 random bytes → a 43-character high-entropy string
 * drawn only from the RFC 7636 §4.1 unreserved charset. `rand` is injected in tests for
 * determinism; production uses Web Crypto.
 */
export function generateCodeVerifier(rand: (n: number) => Uint8Array = defaultRand): string {
  return base64UrlEncode(rand(32));
}

/** Default digest: real SHA-256 via Web Crypto (deterministic — a fixed hash of a fixed input).
 * Passes a `Uint8Array` VIEW over a fresh `ArrayBuffer` (never the raw buffer): `ArrayBuffer.isView`
 * accepts a view cross-realm, whereas a bare `ArrayBuffer` fails Node 20's stricter same-realm check
 * under jsdom (the CI test env); the fresh-buffer view is also typed `Uint8Array<ArrayBuffer>`, which
 * satisfies the strict `BufferSource` parameter type. */
const defaultDigest = (data: Uint8Array): Promise<ArrayBuffer> => {
  const bytes = new Uint8Array(data.byteLength);
  bytes.set(data);
  return crypto.subtle.digest('SHA-256', bytes);
};

/**
 * The S256 `code_challenge` for a verifier: base64url(SHA-256(ASCII(verifier))). The verifier is
 * hashed as its raw ASCII bytes (never JSON-wrapped or re-encoded). `digest` is injectable; the
 * default is Web Crypto's SHA-256.
 */
export async function computeCodeChallenge(
  verifier: string,
  digest: (data: Uint8Array) => Promise<ArrayBuffer> = defaultDigest,
): Promise<string> {
  const ascii = Uint8Array.from(verifier, (ch) => ch.charCodeAt(0) & 0xff);
  const hash = await digest(ascii);
  return base64UrlEncode(new Uint8Array(hash));
}

/**
 * A fresh anti-CSRF `state`: base64url of ≥16 random bytes (≥122 bits of entropy). Compared
 * verbatim on the redirect callback to bind the response to this request.
 */
export function generateState(rand: (n: number) => Uint8Array = defaultRand): string {
  return base64UrlEncode(rand(16));
}
