import { useStore } from '@/store/useStore';
import { useCalculators, useFindings, useFlags, useRelations } from '../hooks';
import { FlagCard } from '../components/FlagCard';
import { ClinicalBoundary } from '../components/ClinicalBoundary';
import { ProvenanceMark } from '../components/ProvenanceMark';
import { CATEGORIES, categoryColor } from '@/data/categories';
import { PROV_META, PROVENANCE_ORDER, provenanceSummary } from '@/data/provenance';

/** Visible one-line key explaining the provenance glyphs and that source carries weight. */
const PROV_LEGEND = PROVENANCE_ORDER.map((p) => `${PROV_META[p].mark} ${PROV_META[p].label}`).join(
  ' · ',
);

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
        <h1 className="page-title" tabIndex={-1}>
          Family Patterns
        </h1>
        <label className="row" style={{ gap: 8 }}>
          <span className="mono-dim">Vantage</span>
          <select
            className="field"
            style={{ width: 'auto' }}
            value={riskRoot}
            onChange={(e) => setRiskRoot(e.target.value)}
            title="Re-roots pattern detection on this person. Overview always shows your own perspective."
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
      <ClinicalBoundary />
      {/* View-specific value only — ClinicalBoundary above already states "surfaces
          red-flag patterns and the criteria they meet, never a risk number", so this lede
          adds the vantage framing and the calculator pointer instead of restating it. */}
      <p className="lede">
        Findings below reflect {rootName}&rsquo;s vantage in the family tree — re-root with the
        selector above. Validated calculators are the right tool where an actual number is needed.
      </p>
      {/* Reference material a frequent user already knows — collapsed by default rather
          than a permanent line, matching the pedigree's own notation-key disclosure. */}
      <details className="pedigree-guide" style={{ margin: '0 0 18px' }}>
        <summary className="pedigree-guide__toggle">Provenance key</summary>
        <p className="pedigree-guide__text">
          {PROV_LEGEND} — clinicians weight family history by its source (a records-confirmed
          diagnosis carries more than a recollection).
        </p>
      </details>

      <section style={{ marginBottom: 26 }}>
        <h2 className="section-label">Detected patterns</h2>
        <p className="mono-dim" style={{ margin: '-7px 0 12px' }}>
          Named hereditary red-flag patterns — HBOC, Lynch, and similar published criteria.
        </p>
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
          <h2 className="section-label">Validated risk calculators</h2>
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
        <h2 className="section-label">Per-condition family findings</h2>
        <p className="mono-dim" style={{ margin: '-7px 0 12px' }}>
          Every condition recorded in the family, regardless of pattern status.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {findings.map((f) => (
            <div className="card" key={f.id} style={{ padding: '12px 14px' }}>
              <div className="row" style={{ justifyContent: 'space-between', gap: 10 }}>
                <div className="row">
                  <span
                    aria-hidden="true"
                    style={{
                      width: 9,
                      height: 9,
                      borderRadius: 2,
                      background: categoryColor(f.cat, palette),
                      flex: 'none',
                    }}
                  />
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{f.name}</span>
                  <span className="mono-dim">{CATEGORIES[f.cat].label}</span>
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
                <>
                  <div className="mono-dim" style={{ marginTop: 7 }}>
                    {f.affected.map((a, i) => (
                      <span key={i}>
                        {i > 0 ? ' · ' : ''}
                        {a.rel} ({a.deg}
                        {a.onset != null ? `, onset ${a.onset}` : ''}){' '}
                        <ProvenanceMark prov={a.prov} />
                      </span>
                    ))}
                  </div>
                  <div className="mono-dim" style={{ marginTop: 4, color: 'var(--text-dim)' }}>
                    Sourcing: {provenanceSummary(f.affected.map((a) => a.prov))}
                  </div>
                </>
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
