/**
 * Oracle for `src/integrations/smart-fhir/pkce.ts` — the RFC 7636 PKCE (S256) helpers that
 * anchor the SMART-on-FHIR standalone-launch authorization request. Every randomness/digest
 * source is injected so the suite is fully deterministic (never real entropy, never the wall
 * clock). The `computeCodeChallenge` known-answer test does exercise the REAL `crypto.subtle`
 * SHA-256 default digest against the fixed RFC 7636 Appendix B vector — that's not "real
 * randomness", it's a deterministic hash of a fixed, hardcoded input, so the result is pinned
 * and reproducible on every run.
 */
import { describe, expect, it, vi } from 'vitest';
import { base64UrlEncode, computeCodeChallenge, generateCodeVerifier, generateState } from './pkce';

describe('base64UrlEncode', () => {
  it('replaces "+" and "/" with "-" and "_" (bytes chosen to produce both in standard base64)', () => {
    // Buffer.from([251,255,191]).toString('base64') === '+/+/' (verified out-of-band).
    expect(base64UrlEncode(new Uint8Array([251, 255, 191]))).toBe('-_-_');
  });

  it('strips a single "=" padding character', () => {
    // Buffer.from([0,1]).toString('base64') === 'AAE='
    expect(base64UrlEncode(new Uint8Array([0, 1]))).toBe('AAE');
  });

  it('strips a double "==" padding sequence', () => {
    // Buffer.from([0]).toString('base64') === 'AA=='
    expect(base64UrlEncode(new Uint8Array([0]))).toBe('AA');
  });

  it('encodes 32 zero bytes to the expected 43-character no-padding string', () => {
    const out = base64UrlEncode(new Uint8Array(32));
    expect(out).toBe('A'.repeat(43));
    expect(out).toHaveLength(43);
  });

  it('never emits a "+", "/", or "=" character regardless of input', () => {
    const out = base64UrlEncode(new Uint8Array([251, 255, 191, 0, 1, 0]));
    expect(out).not.toMatch(/[+/=]/);
  });
});

describe('generateCodeVerifier', () => {
  it('base64url-encodes exactly 32 injected random bytes into a 43-character verifier', () => {
    const fixedBytes = Uint8Array.from({ length: 32 }, (_, i) => i);
    const rand = vi.fn((n: number) => {
      expect(n).toBe(32);
      return fixedBytes;
    });
    const verifier = generateCodeVerifier(rand);
    // Buffer.from([0..31]).toString('base64url') (verified out-of-band).
    expect(verifier).toBe('AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8');
    expect(verifier).toHaveLength(43);
    expect(rand).toHaveBeenCalledTimes(1);
  });

  it('only uses the unreserved base64url charset (RFC 7636 §4.1) for any injected bytes', () => {
    const rand = () => Uint8Array.from({ length: 32 }, (_, i) => (i * 37 + 251) % 256);
    const verifier = generateCodeVerifier(rand);
    expect(verifier).toMatch(/^[A-Za-z0-9\-_]{43}$/);
  });

  it('defaults rand to crypto.getRandomValues, requesting a 32-byte buffer', () => {
    const spy = vi.spyOn(crypto, 'getRandomValues');
    try {
      const verifier = generateCodeVerifier();
      expect(spy).toHaveBeenCalledTimes(1);
      const requested = spy.mock.calls[0][0] as Uint8Array;
      expect(requested).toHaveLength(32);
      expect(verifier).toHaveLength(43);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('computeCodeChallenge', () => {
  it('reproduces the RFC 7636 Appendix B known-answer vector via the real SHA-256 default digest', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const challenge = await computeCodeChallenge(verifier);
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('digests the verifier as its raw ASCII bytes (not JSON, not re-encoded) via an injected digest fn', async () => {
    let seenInput: Uint8Array | undefined;
    const fakeDigest = (data: Uint8Array): Promise<ArrayBuffer> => {
      seenInput = data;
      return Promise.resolve(new Uint8Array([1, 2, 3, 4]).buffer);
    };
    const challenge = await computeCodeChallenge('abc', fakeDigest);
    expect(Array.from(seenInput ?? [])).toEqual([97, 98, 99]); // 'a', 'b', 'c'
    expect(challenge).toBe(base64UrlEncode(new Uint8Array([1, 2, 3, 4])));
  });

  it('produces a different challenge for a different verifier (not a constant)', async () => {
    const a = await computeCodeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');
    const b = await computeCodeChallenge('a-totally-different-verifier-string-1234567');
    expect(a).not.toBe(b);
  });
});

describe('generateState', () => {
  it('base64url-encodes injected random bytes into the expected state string', () => {
    const fixedBytes = Uint8Array.from({ length: 16 }, (_, i) => i + 1);
    const state = generateState(() => fixedBytes);
    // Buffer.from([1..16]).toString('base64url') (verified out-of-band).
    expect(state).toBe('AQIDBAUGBwgJCgsMDQ4PEA');
  });

  it('requests at least 16 bytes (>=122 bits) of entropy from rand', () => {
    let requested = -1;
    generateState((n) => {
      requested = n;
      return new Uint8Array(n);
    });
    expect(requested).toBeGreaterThanOrEqual(16);
  });

  it('defaults rand to crypto.getRandomValues when no override is injected', () => {
    const spy = vi.spyOn(crypto, 'getRandomValues');
    try {
      const state = generateState();
      expect(spy).toHaveBeenCalledTimes(1);
      const requested = spy.mock.calls[0][0] as Uint8Array;
      expect(requested.length).toBeGreaterThanOrEqual(16);
      expect(state).toMatch(/^[A-Za-z0-9\-_]+$/);
    } finally {
      spy.mockRestore();
    }
  });
});
