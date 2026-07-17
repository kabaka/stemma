/**
 * Vocabulary lookup — the bridge to the ICD-10-CM long tail (~74,000 codes) that the
 * curated catalog deliberately does not enumerate.
 *
 * {@link VocabularyProvider} is a port: the app depends on the interface, not a
 * specific service. The default {@link NlmClinicalTablesProvider} hits the NLM
 * Clinical Table Search Service, which is CORS-enabled and needs no API key, so it
 * works from the static GitHub Pages build with no backend and no runtime MCP. A
 * self-hosted deployment can swap in a fuller terminology server (SNOMED/UMLS, or a
 * FHIR `$expand`) by implementing the same interface. See roadmap §3.
 */
import type { Condition } from '@/domain/types';
import { conditionFromCode } from '@/domain/catalog';

export interface VocabularyHit {
  /** ICD-10-CM code, e.g. `'C50.911'`. */
  code: string;
  /** Official long description. */
  name: string;
  /** Terminology system label, e.g. `'ICD-10-CM'`. */
  system: string;
}

export interface VocabularySearchOptions {
  limit?: number;
  signal?: AbortSignal;
}

export interface VocabularyProvider {
  /** Human-readable provider name, shown in the UI. */
  readonly name: string;
  /** The terminology system this provider searches. */
  readonly system: string;
  search(query: string, opts?: VocabularySearchOptions): Promise<VocabularyHit[]>;
}

const NLM_DEFAULT_URL = 'https://clinicaltables.nlm.nih.gov/api/icd10cm/v3/search';

/**
 * Shape of the NLM Clinical Tables response:
 * `[totalCount, [codes...], null, [[code, name], ...]]`.
 */
type NlmResponse = [number, string[], unknown, [string, string][]];

/** Default client-side ICD-10-CM provider backed by the NLM Clinical Tables API. */
export class NlmClinicalTablesProvider implements VocabularyProvider {
  readonly name = 'NLM Clinical Tables';
  readonly system = 'ICD-10-CM';
  private readonly baseUrl: string;

  constructor(baseUrl: string = NLM_DEFAULT_URL) {
    this.baseUrl = baseUrl;
  }

  async search(query: string, opts: VocabularySearchOptions = {}): Promise<VocabularyHit[]> {
    const q = query.trim();
    if (!q) return [];
    const params = new URLSearchParams({
      terms: q,
      sf: 'code,name',
      df: 'code,name',
      maxList: String(opts.limit ?? 20),
    });
    const res = await fetch(`${this.baseUrl}?${params.toString()}`, { signal: opts.signal });
    if (!res.ok) throw new Error(`Vocabulary lookup failed: ${res.status} ${res.statusText}`);
    const data = (await res.json()) as NlmResponse;
    const rows = Array.isArray(data) && Array.isArray(data[3]) ? data[3] : [];
    return rows.map(([code, name]) => ({ code, name, system: this.system }));
  }
}

/**
 * Convert a vocabulary hit into a catalog {@link Condition} so it can be attached to a
 * person. Long-tail codes have no curated metadata, so they resolve to a generic
 * category and prevalence; the pattern engine treats them accordingly.
 */
export function hitToCondition(hit: VocabularyHit): Condition {
  // An ICD-10-CM hit carries its code as the `icd10` coding via the shared long-tail builder;
  // a hit from any other terminology (the provider's free-text `system` label isn't our
  // canonical `'SNOMED-CT'`) resolves to a bare generic keyed by its code, unchanged from the
  // prior behaviour so no `snomed` coding is fabricated from an unverified label.
  return hit.system === 'ICD-10-CM'
    ? conditionFromCode('ICD-10-CM', hit.code, hit.name)
    : { id: hit.code, name: hit.name, cat: 'other', base: 0, pattern: '—' };
}

/** The provider the app uses by default. */
export const defaultVocabularyProvider: VocabularyProvider = new NlmClinicalTablesProvider();
