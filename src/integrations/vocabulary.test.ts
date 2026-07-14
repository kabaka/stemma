import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NlmClinicalTablesProvider, hitToCondition, type VocabularyHit } from './vocabulary';

/** Minimal stand-in for the subset of `Response` the provider actually reads. */
function jsonResponse(
  body: unknown,
  init: { ok?: boolean; status?: number; statusText?: string } = {},
): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('NlmClinicalTablesProvider', () => {
  const provider = new NlmClinicalTablesProvider();
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses NLM rows [count, codes, null, [[code, name]…]] into vocabulary hits', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([
        2,
        ['C50.911', 'C50.912'],
        null,
        [
          ['C50.911', 'Malignant neoplasm of right female breast'],
          ['C50.912', 'Malignant neoplasm of left female breast'],
        ],
      ]),
    );
    const hits = await provider.search('breast cancer', { limit: 12 });
    expect(hits).toEqual<VocabularyHit[]>([
      { code: 'C50.911', name: 'Malignant neoplasm of right female breast', system: 'ICD-10-CM' },
      { code: 'C50.912', name: 'Malignant neoplasm of left female breast', system: 'ICD-10-CM' },
    ]);
  });

  it('requests terms/sf/df/maxList on the query string', async () => {
    fetchMock.mockResolvedValue(jsonResponse([0, [], null, []]));
    await provider.search('breast cancer', { limit: 12 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestedUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requestedUrl.searchParams.get('terms')).toBe('breast cancer');
    expect(requestedUrl.searchParams.get('sf')).toBe('code,name');
    expect(requestedUrl.searchParams.get('df')).toBe('code,name');
    expect(requestedUrl.searchParams.get('maxList')).toBe('12');
  });

  it('returns [] without calling fetch for an empty or whitespace-only query', async () => {
    expect(await provider.search('')).toEqual([]);
    expect(await provider.search('   ')).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns [] for a malformed body whose hits array is null', async () => {
    fetchMock.mockResolvedValue(jsonResponse([0, [], null, null]));
    expect(await provider.search('x')).toEqual([]);
  });

  it('returns [] for a malformed body that is not the expected tuple shape', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    expect(await provider.search('x')).toEqual([]);
  });

  it('rejects with the status when the response is not ok', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(null, { ok: false, status: 503, statusText: 'Service Unavailable' }),
    );
    await expect(provider.search('x')).rejects.toThrow(/Vocabulary lookup failed: 503/);
  });

  it('forwards the abort signal to fetch', async () => {
    fetchMock.mockResolvedValue(jsonResponse([0, [], null, []]));
    const controller = new AbortController();
    await provider.search('x', { signal: controller.signal });
    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(requestInit.signal).toBe(controller.signal);
  });
});

describe('hitToCondition', () => {
  it('maps an ICD-10-CM hit to a generic Condition keyed by its code', () => {
    const hit: VocabularyHit = {
      code: 'C50.911',
      name: 'Malignant neoplasm of right female breast',
      system: 'ICD-10-CM',
    };
    expect(hitToCondition(hit)).toEqual({
      id: 'C50.911',
      name: 'Malignant neoplasm of right female breast',
      cat: 'other',
      base: 0,
      pattern: '—',
      icd10: 'C50.911',
    });
  });

  it('omits icd10 for a hit from a non-ICD-10-CM terminology system', () => {
    const hit: VocabularyHit = { code: '254837009', name: 'Breast cancer', system: 'SNOMED CT' };
    expect(hitToCondition(hit).icd10).toBeUndefined();
  });
});
