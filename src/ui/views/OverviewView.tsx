import { useId, useMemo } from 'react';
import { useStore } from '@/store/useStore';
import { useFlags, useScreenings, useAsOfYear } from '../hooks';
import { FlagCard } from '../components/FlagCard';
import { ClinicalBoundary } from '../components/ClinicalBoundary';
import { condIds } from '@/domain/person';
import { dueCount } from '@/domain/screening';
import { computeLayout } from '@/domain/graph';
import { EVENT_META } from '@/data/events';

const SCREEN_COLOR: Record<string, string> = {
  Referred: '#6fa8ff',
  Recommended: '#ffb043',
  Routine: '#34e2cf',
};

/** Landing view: headline stats, top hereditary flags, and screening status. */
export function OverviewView() {
  const record = useStore((s) => s.record);
  const setView = useStore((s) => s.setView);
  const flags = useFlags(record.probandId);
  const screenings = useScreenings(record.probandId);
  const asOf = useAsOfYear();
  const screeningHeadingId = useId();
  const activityHeadingId = useId();

  const relCount = record.people.length - 1;
  const layout = computeLayout(record.people, record.unions);
  const genCount = layout.maxGen - layout.minGen + 1;
  const distinctConds = new Set(record.people.flatMap((p) => condIds(p))).size;
  const referralCount = flags.filter((f) => f.severity === 'referral').length;

  const stats = [
    { value: relCount, label: 'Relatives tracked', color: 'var(--text)' },
    { value: genCount, label: 'Generations', color: 'var(--text)' },
    { value: distinctConds, label: 'Conditions', color: '#6fa8ff' },
    { value: referralCount, label: 'Referral flags', color: 'var(--sev-referral)' },
    { value: dueCount(screenings), label: 'Screenings due', color: 'var(--sev-discuss)' },
  ];

  const topFlags = flags.filter((f) => f.severity !== 'note').slice(0, 3);

  // The proband's three newest timeline events (restored from the prototype). Same-year
  // ties break newest-added-first — later array position is the more recently logged
  // event, mirroring the prototype's insertion-index tiebreaker.
  const recentActivity = useMemo(
    () =>
      record.timeline
        .map((e, i) => ({ e, i }))
        .filter(({ e }) => e.person === record.probandId)
        .sort((a, b) => b.e.year - a.e.year || b.i - a.i)
        .slice(0, 3)
        .map(({ e }) => e),
    [record.timeline, record.probandId],
  );

  return (
    <div className="scroll">
      <div className="page-head">
        <h1 className="page-title">Health Overview</h1>
        <span className="mono-dim">as of {asOf}</span>
      </div>
      <ClinicalBoundary />
      <p className="lede">
        Inheritance signals aggregated across{' '}
        <b style={{ color: 'var(--text)' }}>{relCount} relatives</b> and{' '}
        <b style={{ color: 'var(--text)' }}>{genCount} generations</b>. Stemma is an organizing tool
        that surfaces patterns worth a clinician&rsquo;s attention.
      </p>

      <div className="stat-grid">
        {stats.map((s) => (
          <div className="card" key={s.label}>
            <div className="stat__value" style={{ color: s.color }}>
              {s.value}
            </div>
            <div className="stat__label">{s.label}</div>
          </div>
        ))}
      </div>

      <div
        style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr)', gap: 22 }}
      >
        <section>
          <h2 className="section-label">Family history flags</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            {topFlags.length === 0 && (
              <div className="card" style={{ color: 'var(--text-dim)', fontSize: 13 }}>
                No red-flag family patterns detected. Keep the pedigree up to date — a limited
                history is not the same as low risk.
              </div>
            )}
            {topFlags.map((f) => (
              <FlagCard key={f.title} flag={f} />
            ))}
            {flags.length > topFlags.length && (
              <button
                type="button"
                className="btn btn--sm"
                style={{ alignSelf: 'flex-start' }}
                onClick={() => setView('patterns')}
              >
                View all {flags.length} patterns →
              </button>
            )}
          </div>
        </section>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          <section>
            <h2 className="section-label" id={screeningHeadingId}>
              Screening status
            </h2>
            {/* Real list semantics so AT announces "list, N items" (WCAG 1.3.1); the
                explicit role="list" survives `list-style:none` in Safari/VoiceOver. */}
            <ul
              className="plain-list"
              role="list"
              aria-labelledby={screeningHeadingId}
              style={{ display: 'flex', flexDirection: 'column', gap: 9 }}
            >
              {screenings.map((s) => (
                <li className="card" role="listitem" key={s.id} style={{ padding: '12px 14px' }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{s.name}</span>
                    <span
                      className="badge"
                      style={{
                        color: SCREEN_COLOR[s.status],
                        background: 'rgba(255,255,255,0.05)',
                      }}
                    >
                      {s.status}
                    </span>
                  </div>
                  <div className="mono-dim" style={{ marginTop: 6 }}>
                    {s.freq} · {s.why}
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {recentActivity.length > 0 && (
            <section>
              <h2 className="section-label" id={activityHeadingId}>
                Recent activity
              </h2>
              <ul
                className="plain-list"
                role="list"
                aria-labelledby={activityHeadingId}
                style={{ display: 'flex', flexDirection: 'column', gap: 11 }}
              >
                {recentActivity.map((e) => (
                  <li
                    className="row"
                    role="listitem"
                    key={e.id}
                    style={{ gap: 11, alignItems: 'flex-start' }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: EVENT_META[e.type].color,
                        marginTop: 6,
                        flex: 'none',
                      }}
                    />
                    <div>
                      <div style={{ fontSize: 12.5, color: 'var(--text)' }}>{e.title}</div>
                      <div className="mono-dim" style={{ marginTop: 2 }}>
                        {e.year} · {EVENT_META[e.type].label}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
