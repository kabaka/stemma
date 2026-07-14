import { useStore } from '@/store/useStore';
import { useCalculators, useFindings, useFlags, useRelations } from '../hooks';
import { FlagCard } from '../components/FlagCard';
import { categoryColor } from '@/data/categories';

const BAND_COLOR: Record<string, string> = {
  Diagnosed: '#34e2cf',
  Clustered: '#ff5d5d',
  'Close family': '#ffb043',
  'In family': '#ffd24a',
  '—': '#6fe0a0',
};

/** The hereditary-pattern analysis, re-rootable onto any person in the record. */
export function PatternsView() {
  const record = useStore((s) => s.record);
  const palette = useStore((s) => s.palette);
  const riskRoot = useStore((s) => s.riskRoot);
  const setRiskRoot = useStore((s) => s.setRiskRoot);
  const relations = useRelations(riskRoot);
  const flags = useFlags(riskRoot);
  const calculators = useCalculators(riskRoot);
  const findings = useFindings(riskRoot);

  const rootName = record.people.find((p) => p.id === riskRoot)?.name ?? '';

  return (
    <div className="scroll">
      <div className="page-head">
        <h1 className="page-title">Family Patterns</h1>
        <label className="row" style={{ gap: 8 }}>
          <span className="mono-dim">Vantage</span>
          <select
            className="field"
            style={{ width: 'auto' }}
            value={riskRoot}
            onChange={(e) => setRiskRoot(e.target.value)}
          >
            {record.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.id === record.probandId ? ' (you)' : ` · ${relations.get(p.id)?.rel ?? ''}`}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="lede">
        Published red-flag patterns detected from {rootName}&rsquo;s vantage, each stating the
        specific criterion met. Stemma reports patterns and referral criteria — it never
        manufactures a risk number. Validated calculators below are the right tool where a number is
        needed.
      </p>

      <section style={{ marginBottom: 26 }}>
        <div className="section-label">Detected patterns</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          {flags.length === 0 && (
            <div className="card" style={{ color: 'var(--text-dim)', fontSize: 13 }}>
              No notable patterns from this vantage.
            </div>
          )}
          {flags.map((f) => (
            <FlagCard key={f.title} flag={f} />
          ))}
        </div>
      </section>

      {calculators.length > 0 && (
        <section style={{ marginBottom: 26 }}>
          <div className="section-label">Validated risk calculators</div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: 12,
            }}
          >
            {calculators.map((c) => (
              <div className="card" key={c.name}>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{c.name}</div>
                <div className="mono-dim" style={{ margin: '4px 0 8px' }}>
                  {c.domain}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                  {c.desc}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--accent)', marginTop: 8 }}>
                  {c.summary}
                </div>
                <div className="mono-dim" style={{ marginTop: 6 }}>
                  {c.note}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="section-label">Per-condition family findings</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {findings.map((f) => (
            <div className="card" key={f.id} style={{ padding: '12px 14px' }}>
              <div className="row" style={{ justifyContent: 'space-between', gap: 10 }}>
                <div className="row">
                  <span
                    style={{
                      width: 9,
                      height: 9,
                      borderRadius: 2,
                      background: categoryColor(f.cat, palette),
                      flex: 'none',
                    }}
                  />
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{f.name}</span>
                  <span className="mono-dim">{f.pattern}</span>
                </div>
                <span
                  className="badge"
                  style={{ color: BAND_COLOR[f.band], background: 'rgba(255,255,255,0.05)' }}
                >
                  {f.band}
                </span>
              </div>
              {f.affected.length > 0 && (
                <div className="mono-dim" style={{ marginTop: 7 }}>
                  {f.affected.map((a) => `${a.rel} (${a.deg})`).join(' · ')}
                  {f.earliest != null ? ` · earliest onset ${f.earliest}` : ''}
                </div>
              )}
              <div
                style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 7, lineHeight: 1.5 }}
              >
                {f.rec}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
