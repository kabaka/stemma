import { useStore, type View } from '@/store/useStore';
import { genderSymbol } from '@/domain/person';
import { CURRENT_YEAR } from '@/store/useStore';

const NAV: { id: View; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'tree', label: 'Family Pedigree' },
  { id: 'patterns', label: 'Family Patterns' },
  { id: 'timeline', label: 'My Timeline' },
  { id: 'reports', label: 'Reports & Export' },
];

/** Left rail: brand, navigation, proband summary, and the palette toggle. */
export function Sidebar() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const palette = useStore((s) => s.palette);
  const setPalette = useStore((s) => s.setPalette);
  const record = useStore((s) => s.record);
  const proband = record.people.find((p) => p.id === record.probandId);

  const age = proband?.birth != null ? CURRENT_YEAR - proband.birth : null;

  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <div className="brand-row">
          <span className="brand-mark">
            <i />
          </span>
          <span className="brand-name">STEMMA</span>
        </div>
        <div className="brand-tag">Family health intelligence</div>
      </div>

      <nav aria-label="Primary">
        <ul className="nav">
          {NAV.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="nav-item"
                aria-current={view === item.id ? 'page' : undefined}
                aria-label={item.label}
                onClick={() => setView(item.id)}
              >
                <span>{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="sidebar__foot">
        <button
          type="button"
          className="chip"
          aria-pressed={palette === 'colorblind'}
          onClick={() => setPalette(palette === 'colorblind' ? 'default' : 'colorblind')}
          title="Toggle a colorblind-safe palette. Meaning is never encoded in colour alone."
        >
          {palette === 'colorblind' ? 'Colorblind-safe: on' : 'Colorblind-safe: off'}
        </button>

        {proband && (
          <div>
            <h2 className="overline" style={{ marginBottom: 9 }}>
              Proband
            </h2>
            <div className="row who">
              <span className="avatar">{proband.name.charAt(0)}</span>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>
                  {proband.name}{' '}
                  <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>(you)</span>
                </div>
                <div className="mono-dim">
                  {genderSymbol(proband.gender)} · {age != null ? `${age} yrs` : 'age unknown'}
                  {proband.birth != null ? ` · b.${proband.birth}` : ''}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
