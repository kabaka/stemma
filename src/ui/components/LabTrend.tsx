/**
 * A plain lab-value trend for one test on one person: year, value, and the user's own
 * transcribed reference range. Deliberately NOT a chart with threshold shading. Each value
 * DOES carry a strictly positional restatement of that same row's own recorded bounds — an
 * "above range"/"below range" pill via {@link RangePositionMark}/{@link rangePosition}
 * (DR-0036) — but that is the full extent of it: no severity, no H/L/abnormal vocabulary,
 * no risk number, and no colour-only signalling (guardrail #1). Interpreting what an
 * out-of-range value MEANS remains a clinician's job, not this table's — see the co-located
 * caveat paragraph below the table.
 *
 * Renders no {@link ClinicalBoundary} of its own: it is always embedded in a surface (the
 * timeline) that already carries the page-level boundary, so a second one here would only
 * duplicate it. Guardrail #3 is still honoured — by that page-level boundary plus the
 * marker's own referral-oriented caveat right beneath the table.
 */
import { useId, useState } from 'react';
import { useStore } from '@/store/useStore';
import { labSeries, labTitles, rangePosition } from '@/domain/timeline';
import { RangePositionMark } from './RangePositionMark';

function formatRange(low: number | undefined, high: number | undefined): string {
  if (low == null && high == null) return '—';
  return `${low ?? '—'}–${high ?? '—'}`;
}

export function LabTrend({ personId }: { personId: string }) {
  const record = useStore((s) => s.record);
  const titles = labTitles(record, personId);
  const [selected, setSelected] = useState(titles[0] ?? '');
  const pickerId = useId();
  const headingId = useId();

  // `selected` can go stale — the person changed, or the title it named was edited away —
  // so fall back to the first available title rather than querying one that no longer
  // exists (and never render a <select> with a value that has no matching <option>).
  const activeTitle = titles.includes(selected) ? selected : (titles[0] ?? '');
  const points = activeTitle ? labSeries(record, personId, activeTitle) : [];

  if (titles.length === 0) return null;

  return (
    <section>
      <h2 className="section-label" id={headingId}>
        Lab trend
      </h2>
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
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
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
                  <RangePositionMark position={rangePosition(p.value, p.refLow, p.refHigh)} />
                </td>
                <td>{formatRange(p.refLow, p.refHigh)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Co-located caveat for the "above range"/"below range" pill (DR-0036): this table
          renders no ClinicalBoundary of its own (it is embedded in a surface that already
          carries the page-level one), so the marker earns its explanation right where it is
          read rather than only in a general footer. */}
      <p className="mono-dim" style={{ margin: '8px 0 0', lineHeight: 1.5 }}>
        <em>Above range</em> / <em>below range</em> compares each value against the reference range
        you entered from your own report. Reference ranges depend on the lab, method, age and sex,
        and a value outside the range is not by itself a diagnosis — discuss your results with a
        clinician.
      </p>
    </section>
  );
}
