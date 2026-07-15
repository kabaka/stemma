import { useEffect, useId, useRef, useState } from 'react';
import { useStore } from '@/store/useStore';
import { useCatalog } from '../hooks';
import { condEntry, condIds } from '@/domain/person';
import { CATEGORIES, categoryColor } from '@/data/categories';
import { PROV_LABEL } from '@/data/provenance';
import type { Provenance } from '@/domain/types';
import {
  defaultVocabularyProvider,
  hitToCondition,
  type VocabularyHit,
} from '@/integrations/vocabulary';

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
  // Base id for this picker instance; per-row field ids below key off a condition id too,
  // since one drawer can list several conditions each with their own onset/provenance field.
  const baseId = useId();
  const searchId = `${baseId}-search`;

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
      <h3 className="overline" style={{ marginBottom: 8 }}>
        Conditions
      </h3>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
        {condIds(person).map((id) => {
          const meta = catalog.get(id);
          const entry = condEntry(person, id);
          const onsetId = `${baseId}-onset-${id}`;
          const provId = `${baseId}-prov-${id}`;
          return (
            <div key={id} className="card" style={{ padding: '10px 12px' }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="row" style={{ gap: 8 }}>
                  {/* Category is conveyed by the swatch colour alone for sighted users;
                      name it for screen readers and colourblind users (WCAG 1.4.1). */}
                  <span
                    aria-hidden="true"
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 2,
                      background: categoryColor(meta.cat, palette),
                    }}
                  />
                  <span style={{ fontSize: 13, fontWeight: 600 }}>
                    {meta.name}
                    <span className="visually-hidden"> · {CATEGORIES[meta.cat].label}</span>
                  </span>
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
              {/* Inheritance pattern (e.g. "Autosomal dominant"), restored from the
                  prototype's condition card. Curated conditions carry it; a long-tail
                  ICD-10 condition added via vocabulary search carries only the "—"
                  placeholder, which says nothing — omit the line in that case. The value
                  is labelled for screen readers, which otherwise hear a bare phrase with
                  no indication of what it describes (WCAG 1.3.1). */}
              {meta.pattern && meta.pattern !== '—' && (
                <div className="mono-dim" style={{ marginTop: 4 }}>
                  <span className="visually-hidden">Inheritance pattern: </span>
                  {meta.pattern}
                </div>
              )}
              <div className="row" style={{ gap: 8, marginTop: 8 }}>
                <label className="visually-hidden" htmlFor={onsetId}>
                  Onset age for {meta.name}
                </label>
                <input
                  id={onsetId}
                  className="field"
                  style={{ width: 90 }}
                  type="number"
                  placeholder="onset age"
                  value={entry?.onset ?? ''}
                  onChange={(e) => setConditionField(personId, id, 'onset', e.target.value)}
                />
                <label className="visually-hidden" htmlFor={provId}>
                  Provenance for {meta.name}
                </label>
                <select
                  id={provId}
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

      <label className="visually-hidden" htmlFor={searchId}>
        Search conditions
      </label>
      <input
        id={searchId}
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
          {/* Polite live region: announces the loading → error/results transition without
              moving focus, since the trigger button's own label already changes visually. */}
          <div role="status">
            {vocab.loading && (
              <span className="visually-hidden">Searching ICD-10-CM for {query}…</span>
            )}
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
        </div>
      )}
    </div>
  );
}
