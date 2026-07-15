/**
 * Printable clinical one-pagers — the "bring it to your appointment" surface
 * (roadmap §2, GAP-ANALYSIS H1). Restores the three sheets the prototype printed:
 *
 *  1. A three-generation NSGC pedigree (reusing the SVG export).
 *  2. A family-history red-flag summary — the detected patterns + per-condition findings.
 *  3. An IPS-style personal-health summary for the record owner.
 *
 * Rendered once as a sibling of the app shell (see App.tsx) and hidden on screen; the
 * `@media print` stylesheet hides the dark app chrome and reveals these black-on-white
 * sheets, one per page. Every sheet restates the clinical boundary as a first-class
 * element (guardrail #3), not incidental footer text.
 *
 * Presentational only: it reads the proband's computed engine outputs (never re-deriving
 * a number the engine didn't produce, guardrail #1) and renders them.
 */
import { useMemo } from 'react';
import { useStore } from '@/store/useStore';
import { useAsOfYear, useCatalog, useFindings, useFlags, useScreenings } from '../hooks';
import { buildPedigreeSvg } from '@/export';
import { ORGAN_LABELS, ageOf, condEntry, genderLabel, organsOf, sabLabel } from '@/domain/person';
import { CATEGORY_LABELS } from '@/data/categories';
import { PROV_LABEL } from '@/data/provenance';
import { SEVERITY_META } from '@/data/severity';
import type { Person } from '@/domain/types';

const BOUNDARY =
  'Stemma is an organizing tool that surfaces family-history patterns worth a clinician’s ' +
  'attention — not a diagnostic device. It reports published referral criteria, never a ' +
  'computed risk number. Discuss anything here with a clinician or genetic counselor.';

/** The clinical-boundary block repeated at the foot of every sheet (guardrail #3). */
function BoundaryFooter() {
  return (
    <div className="print-boundary" role="note">
      <b>Clinical boundary.</b> {BOUNDARY}
    </div>
  );
}

function SheetHead({ title, subtitle }: { title: string; subtitle: string }) {
  // UI layer may read the wall clock; the printed date is informational, not engine input.
  const generated = new Date().toISOString().slice(0, 10);
  return (
    <header className="print-head">
      <div>
        <div className="print-brand">Stemma</div>
        <h2 className="print-title">{title}</h2>
        <div className="print-subtitle">{subtitle}</div>
      </div>
      <div className="print-generated">Generated {generated}</div>
    </header>
  );
}

function personLine(p: Person, asOfYear: number): string {
  const bits = [sabLabel(p.sab), genderLabel(p.gender)];
  if (p.birth != null) {
    const age = ageOf(p, asOfYear);
    bits.push(`b. ${p.birth}${age != null ? ` (age ${age})` : ''}`);
  }
  if (p.dead) bits.push(p.death != null ? `d. ${p.death}` : 'deceased');
  return bits.join(' · ');
}

export function PrintReports() {
  const record = useStore((s) => s.record);
  const palette = useStore((s) => s.palette);
  const catalog = useCatalog();
  const asOfYear = useAsOfYear();
  const flags = useFlags(record.probandId);
  const findings = useFindings(record.probandId);
  const screenings = useScreenings(record.probandId);

  const proband = record.people.find((p) => p.id === record.probandId) ?? record.people[0] ?? null;
  // This component stays mounted (a sibling of the app shell) behind `display:none`, so it
  // re-renders on every store change even off-screen — memoise the SVG layout so a person
  // edit while on another view doesn't recompute the whole pedigree drawing.
  const pedigreeSvg = useMemo(
    () => buildPedigreeSvg(record, catalog, { palette }),
    [record, catalog, palette],
  );
  const affectedFindings = findings.filter((f) => f.affCount > 0 || f.diagnosed);
  const timeline = proband
    ? record.timeline
        .filter((e) => e.person === proband.id)
        .slice()
        .sort((a, b) => b.year - a.year)
    : [];

  if (!proband) return null;
  const organs = organsOf(proband);

  return (
    // Hidden on screen via `display:none` (see components.css), which already removes it
    // from the accessibility tree — no `aria-hidden` needed. It reappears only in print.
    <div className="print-reports">
      {/* The printed document's root heading: `.app` (which holds the on-screen <h1>) is
          hidden in print, so without this the outline would start at <h2>. Visually hidden
          — the per-sheet <h2> titles carry the visible headers. */}
      <h1 className="visually-hidden">Stemma clinical print reports for {proband.name}</h1>
      {/* Sheet 1 — three-generation pedigree */}
      <section className="print-sheet">
        <SheetHead
          title="Family pedigree"
          subtitle={`${proband.name} · three-generation NSGC-notation pedigree`}
        />
        <div
          className="print-pedigree"
          // Trusted, app-generated SVG string (no user markup): the serialiser emits only
          // shapes/labels it authored — same source as the on-screen Reports preview.
          dangerouslySetInnerHTML={{ __html: pedigreeSvg }}
        />
        <p className="print-note">
          Squares = assigned male at birth · circles = assigned female · diamond = unknown; a shaded
          glyph is affected, a slash is deceased, the arrow marks {proband.name}.
        </p>
        <BoundaryFooter />
      </section>

      {/* Sheet 2 — family-history red-flag summary */}
      <section className="print-sheet">
        <SheetHead
          title="Family-history red-flag summary"
          subtitle={`Detected patterns from ${proband.name}’s vantage, each citing the criterion met`}
        />
        {flags.length === 0 ? (
          <p className="print-empty">
            No red-flag family patterns detected. A limited history is not the same as low risk —
            keep the record current.
          </p>
        ) : (
          <ul className="print-flags">
            {flags.map((f) => (
              <li className="print-flag" key={f.title}>
                <div className="print-flag-head">
                  <span className="print-flag-title">{f.title}</span>
                  <span className="print-flag-sev">{SEVERITY_META[f.severity].label}</span>
                </div>
                <div className="print-flag-crit">
                  <b>Criterion met:</b> {f.criterion}
                </div>
                {f.relatives.length > 0 && (
                  <div className="print-flag-rel">
                    Affected relatives:{' '}
                    {f.relatives
                      .map(
                        (r) =>
                          `${r.rel}${r.onset != null ? ` (onset ${r.onset})` : ''} · ${PROV_LABEL[r.prov]}`,
                      )
                      .join('; ')}
                  </div>
                )}
                <div className="print-flag-rec">{f.rec}</div>
              </li>
            ))}
          </ul>
        )}

        {affectedFindings.length > 0 && (
          <div className="print-findings">
            <h3 className="print-subhead">Conditions in the family</h3>
            <table className="print-table">
              <thead>
                <tr>
                  <th scope="col">Condition</th>
                  <th scope="col">Category</th>
                  <th scope="col">Family status</th>
                  <th scope="col">Earliest onset</th>
                </tr>
              </thead>
              <tbody>
                {affectedFindings.map((f) => (
                  <tr key={f.id}>
                    <td>{f.name}</td>
                    <td>{CATEGORY_LABELS[f.cat]}</td>
                    <td>{f.band}</td>
                    <td>{f.earliest != null ? f.earliest : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <BoundaryFooter />
      </section>

      {/* Sheet 3 — IPS-style personal-health summary */}
      <section className="print-sheet">
        <SheetHead
          title="Personal health summary"
          subtitle={`${proband.name} · ${personLine(proband, asOfYear)}`}
        />

        <h3 className="print-subhead">Screening-relevant organ inventory</h3>
        <p className="print-note">
          {organs.length > 0
            ? `${organs.map((o) => ORGAN_LABELS[o]).join(' · ')}.`
            : 'No screening-relevant organs recorded.'}{' '}
          Screening keys off organs present, not gender.
        </p>

        <h3 className="print-subhead">Conditions</h3>
        {proband.conds.length === 0 ? (
          <p className="print-empty">None recorded.</p>
        ) : (
          <table className="print-table">
            <thead>
              <tr>
                <th scope="col">Condition</th>
                <th scope="col">Category</th>
                <th scope="col">Onset</th>
                <th scope="col">Source</th>
              </tr>
            </thead>
            <tbody>
              {proband.conds.map((c) => {
                const cond = catalog.get(c.id);
                const entry = condEntry(proband, c.id);
                return (
                  <tr key={c.id}>
                    <td>{cond.name}</td>
                    <td>{CATEGORY_LABELS[cond.cat]}</td>
                    <td>{entry?.onset != null ? entry.onset : '—'}</td>
                    <td>{PROV_LABEL[c.prov]}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <h3 className="print-subhead">Recommended screening</h3>
        {screenings.length === 0 ? (
          <p className="print-empty">No screening recommendations from the current record.</p>
        ) : (
          <table className="print-table">
            <thead>
              <tr>
                <th scope="col">Screening</th>
                <th scope="col">Status</th>
                <th scope="col">Frequency</th>
                <th scope="col">Why</th>
              </tr>
            </thead>
            <tbody>
              {screenings.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td>{s.status}</td>
                  <td>{s.freq}</td>
                  <td>{s.why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {timeline.length > 0 && (
          <>
            <h3 className="print-subhead">Health timeline</h3>
            <table className="print-table">
              <thead>
                <tr>
                  <th scope="col">Year</th>
                  <th scope="col">Type</th>
                  <th scope="col">Event</th>
                </tr>
              </thead>
              <tbody>
                {timeline.map((e) => (
                  <tr key={e.id}>
                    <td>{e.year}</td>
                    <td>{e.type}</td>
                    <td>
                      {e.title}
                      {e.detail ? ` — ${e.detail}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        <BoundaryFooter />
      </section>
    </div>
  );
}
