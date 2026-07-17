/**
 * "Currently taking" — a read-model over the timeline's structured medication events
 * (guardrail #1: this only *projects* recorded facts — event title, dose, start year —
 * never infers or interprets them). Mirrors OverviewView's screening-list semantics
 * (`role="list"`) so assistive tech announces "list, N items".
 */
import { useId } from 'react';
import { CURRENT_YEAR, useStore } from '@/store/useStore';
import { currentMedications } from '@/domain/timeline';

export function CurrentMedications({ personId }: { personId: string }) {
  const record = useStore((s) => s.record);
  const headingId = useId();
  const meds = currentMedications(record, personId, CURRENT_YEAR);

  return (
    <section>
      <h2 className="section-label" id={headingId}>
        Currently taking
      </h2>
      {meds.length === 0 ? (
        <div className="card" style={{ color: 'var(--text-dim)', fontSize: 12.5 }}>
          No current medications recorded. Add a medication event and mark it “ongoing” with a dose
          to see it here.
        </div>
      ) : (
        <ul
          className="plain-list"
          role="list"
          aria-labelledby={headingId}
          style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
        >
          {meds.map(({ event, startYear }) => (
            <li className="card" role="listitem" key={event.id} style={{ padding: '10px 14px' }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{event.title}</span>
                {event.med?.dose && <span className="mono-dim">{event.med.dose}</span>}
              </div>
              <div className="mono-dim" style={{ marginTop: 4 }}>
                since {startYear}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
