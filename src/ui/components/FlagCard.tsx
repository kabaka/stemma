import type { PatternFlag } from '@/domain/patterns';
import { SEVERITY_META } from '@/data/severity';

/** A single hereditary-pattern flag: criterion met + advisory recommendation. */
export function FlagCard({ flag }: { flag: PatternFlag }) {
  const meta = SEVERITY_META[flag.severity];
  return (
    <div className="flag" style={{ borderLeftColor: meta.color }}>
      <div className="flag__head">
        <div className="row">
          <span
            style={{ width: 9, height: 9, borderRadius: 2, background: meta.color, flex: 'none' }}
          />
          <span className="flag__title">{flag.title}</span>
        </div>
        <span className="badge" style={{ background: meta.bg, color: meta.color }}>
          {meta.label}
        </span>
      </div>
      <p className="flag__criterion">{flag.criterion}</p>
      <p className="flag__rec">{flag.rec}</p>
      {flag.relatives.length > 0 && (
        <div className="row wrap" style={{ marginTop: 10, gap: 6 }}>
          {flag.relatives.map((r, i) => (
            <span
              key={`${r.person.id}-${i}`}
              className="badge"
              style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-dim)' }}
            >
              {r.rel}
              {r.onset != null ? ` · ${r.onset}` : ''}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
