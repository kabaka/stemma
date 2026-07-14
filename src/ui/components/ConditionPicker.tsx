import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/store/useStore';
import { useCatalog } from '../hooks';
import { condEntry, condIds } from '@/domain/person';
import { categoryColor } from '@/data/categories';
import type { Provenance } from '@/domain/types';
import {
  defaultVocabularyProvider,
  hitToCondition,
  type VocabularyHit,
} from '@/integrations/vocabulary';

const PROV_LABEL: Record<Provenance, string> = {
  self: 'self-reported',
  record: 'records-confirmed',
  death: 'death certificate',
};

/** Add, remove, and annotate a person's conditions. Curated catalog first; the ICD-10
 * long tail is reachable via the live vocabulary provider. */
export function ConditionPicker({ personId }: { personId: string }) {
  const catalog = useCatalog();
  const palette = useStore((s) => s.palette);
  const person = useStore((s) => s.record.people.find((p) => p.id === personId));
  const toggleCondition = useStore((s) => s.toggleCondition);
  const setConditionField = useStore((s) => s.setConditionField);
  const registerCondition = useStore((s) => s.registerCondition);

  const [query, setQuery] = useState('');
  const [vocab, setVocab] = useState<{
    loading: boolean;
    hits: VocabularyHit[];
    error: string | null;
  }>({
    loading: false,
    hits: [],
    error: null,
  });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  if (!person) return null;
  const current = new Set(condIds(person));
  const results = catalog.search(query, current, 12);

  const searchVocabulary = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setVocab({ loading: true, hits: [], error: null });
    try {
      const hits = await defaultVocabularyProvider.search(query, {
        limit: 12,
        signal: controller.signal,
      });
      setVocab({ loading: false, hits, error: hits.length ? null : 'No ICD-10-CM matches.' });
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setVocab({ loading: false, hits: [], error: 'Lookup failed — check your connection.' });
    }
  };

  const addVocabHit = (hit: VocabularyHit) => {
    registerCondition(hitToCondition(hit));
    if (!current.has(hit.code)) toggleCondition(personId, hit.code);
    setVocab({ loading: false, hits: [], error: null });
    setQuery('');
  };

  return (
    <div>
      <div className="overline" style={{ marginBottom: 8 }}>
        Conditions
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
        {condIds(person).map((id) => {
          const meta = catalog.get(id);
          const entry = condEntry(person, id);
          return (
            <div key={id} className="card" style={{ padding: '10px 12px' }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="row" style={{ gap: 8 }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 2,
                      background: categoryColor(meta.cat, palette),
                    }}
                  />
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{meta.name}</span>
                </span>
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => toggleCondition(personId, id)}
                  aria-label={`Remove ${meta.name}`}
                >
                  ✕
                </button>
              </div>
              <div className="row" style={{ gap: 8, marginTop: 8 }}>
                <input
                  className="field"
                  style={{ width: 90 }}
                  type="number"
                  placeholder="onset age"
                  value={entry?.onset ?? ''}
                  onChange={(e) => setConditionField(personId, id, 'onset', e.target.value)}
                />
                <select
                  className="field"
                  style={{ width: 'auto', flex: 1 }}
                  value={entry?.prov ?? 'self'}
                  onChange={(e) => setConditionField(personId, id, 'prov', e.target.value)}
                >
                  {(Object.keys(PROV_LABEL) as Provenance[]).map((p) => (
                    <option key={p} value={p}>
                      {PROV_LABEL[p]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          );
        })}
        {condIds(person).length === 0 && <div className="mono-dim">No conditions recorded.</div>}
      </div>

      <input
        className="field"
        placeholder="Search conditions…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ marginBottom: 8 }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {results.map((r) => (
          <button
            key={r.id}
            type="button"
            className="btn btn--sm"
            style={{ justifyContent: 'flex-start', textAlign: 'left' }}
            onClick={() => toggleCondition(personId, r.id)}
          >
            + {r.name}{' '}
            <span className="mono-dim" style={{ marginLeft: 6 }}>
              {r.categoryLabel}
            </span>
          </button>
        ))}
      </div>

      {query.trim().length > 1 && (
        <div style={{ marginTop: 10 }}>
          <button
            type="button"
            className="btn btn--sm"
            onClick={searchVocabulary}
            disabled={vocab.loading}
          >
            {vocab.loading ? 'Searching ICD-10…' : `Search all ICD-10-CM for “${query}”`}
          </button>
          {vocab.error && (
            <div className="mono-dim" style={{ marginTop: 6 }}>
              {vocab.error}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
            {vocab.hits.map((hit) => (
              <button
                key={hit.code}
                type="button"
                className="btn btn--sm"
                style={{ justifyContent: 'flex-start', textAlign: 'left' }}
                onClick={() => addVocabHit(hit)}
              >
                + {hit.name}{' '}
                <span className="mono-dim" style={{ marginLeft: 6 }}>
                  {hit.code}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
