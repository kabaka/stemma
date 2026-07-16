/**
 * A plain lab-value trend for one test on one person: year, value, and the user's own
 * transcribed reference range. Deliberately NOT a chart with threshold shading and NOT a
 * computed in-range/out-of-range flag — interpreting a value against a range is a
 * clinician's job, not this table's (guardrail #1). Carries its own {@link ClinicalBoundary}
 * because a trend, more than most surfaces, invites a self-read diagnosis (guardrail #3).
 */
import { useId, useMemo, useState } from 'react';
import { useStore } from '@/store/useStore';
import { labSeries, labTitles } from '@/domain/timeline';
import { ClinicalBoundary } from './ClinicalBoundary';

function formatRange(low: number | undefined, high: number | undefined): string {
  if (low == null && high == null) return '—';
  return `${low ?? '—'}–${high ?? '—'}`;
}

export function LabTrend({ personId }: { personId: string }) {
  const record = useStore((s) => s.record);
  const titles = useMemo(() => labTitles(record, personId), [record, personId]);
  const [selected, setSelected] = useState(titles[0] ?? '');
  const pickerId = useId();
  const headingId = useId();

  // `selected` can go stale — the person changed, or the title it named was edited away —
  // so fall back to the first available title rather than querying one that no longer
  // exists (and never render a <select> with a value that has no matching <option>).
  const activeTitle = titles.includes(selected) ? selected : (titles[0] ?? '');
  const points = useMemo(
    () => (activeTitle ? labSeries(record, personId, activeTitle) : []),
    [record, personId, activeTitle],
  );

  if (titles.length === 0) return null;

  return (
    <section>
      <h2 className="section-label" id={headingId}>
        Lab trend
      </h2>
      <ClinicalBoundary />
      <label className="row" style={{ gap: 8, marginBottom: 10 }} htmlFor={pickerId}>
        <span className="mono-dim">Test</span>
        <select
          id={pickerId}
          className="field"
          style={{ width: 'auto' }}
          value={activeTitle}
          onChange={(e) => setSelected(e.target.value)}
        >
          {titles.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="data-table" aria-labelledby={headingId}>
          <thead>
            <tr>
              <th scope="col">Year</th>
              <th scope="col">Value</th>
              <th scope="col">Reference range</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.eventId}>
                <td>{p.year}</td>
                <td>
                  {p.value} {p.unit}
                </td>
                <td>{formatRange(p.refLow, p.refHigh)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
