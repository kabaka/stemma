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
 * sheets, one per page. The clinical boundary runs as a single fixed footer repeated by
 * the browser on every physical printed page (guardrail #3) — a first-class element, not
 * incidental footer text, but now a running page footer rather than one block per sheet.
 *
 * Presentational only: it reads the proband's computed engine outputs (never re-deriving
 * a number the engine didn't produce, guardrail #1) and renders them.
 */
import { useStore } from '@/store/useStore';
import { useAsOfYear, useCatalog, useFindings, useFlags, useScreenings } from '../hooks';
import { buildPedigreeSvg, windowedPeople } from '@/export';
import { ORGAN_LABELS, ageOf, condEntry, genderLabel, organsOf, sabLabel } from '@/domain/person';
import { allergies, currentMedications, immunizations } from '@/domain/timeline';
import { CATEGORY_LABELS, categoryColor, legendCategories } from '@/data/categories';
import { PROV_LABEL } from '@/data/provenance';
import { SEVERITY_META } from '@/data/severity';
import { CLINICAL_BOUNDARY_TEXT } from '@/domain/boundary';
import type { FamilyFinding } from '@/domain/patterns';
import type { Person } from '@/domain/types';

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

/** Compact, capped "who has it" sub-line for a family-finding row: "You" (from the
 * proband's own record, if diagnosed) then affected relatives closest-first, each with
 * onset if known — mirroring the `.print-flag-rel` line's relationship/onset idiom one
 * section above, but capped at 3 entries plus a "+N more" tail so a widely-clustered
 * condition can't blow out the table row. Only ever restates facts already on the
 * finding (guardrail #1) — never a fresh computation. */
function affectedLine(f: FamilyFinding, proband: Person): string {
  const entries: string[] = [];
  if (f.diagnosed) {
    const entry = condEntry(proband, f.id);
    entries.push(entry?.onset != null ? `You (onset ${entry.onset})` : 'You');
  }
  for (const r of f.affected) {
    entries.push(`${r.rel}${r.onset != null ? ` (${r.onset})` : ''}`);
  }
  const shown = entries.slice(0, 3);
  const more = entries.length - shown.length;
  return shown.join(' · ') + (more > 0 ? ` · +${more} more` : '');
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
  // re-renders on every store change even off-screen — the React Compiler memoises the SVG
  // layout so a person edit while on another view doesn't recompute the whole pedigree drawing.
  const pedigreeSvg = buildPedigreeSvg(record, catalog, { palette });
  // Same windowed set the pedigree SVG itself draws (three-generation window centred on the
  // proband) — the colour key below should list only categories that actually appear on Sheet
  // 1's drawing, not every category present anywhere in the full record.
  const keyCats = legendCategories(windowedPeople(record), catalog);
  const affectedFindings = findings.filter((f) => f.affCount > 0 || f.diagnosed);
  const timeline = proband
    ? record.timeline
        .filter((e) => e.person === proband.id)
        .slice()
        .sort((a, b) => b.year - a.year)
    : [];

  if (!proband) return null;
  const organs = organsOf(proband);
  const meds = currentMedications(record, proband.id, asOfYear);
  const allergyEntries = allergies(record, proband.id);
  const immunizationEntries = immunizations(record, proband.id);

  return (
    // Hidden on screen via `display:none` (see components.css), which already removes it
    // from the accessibility tree — no `aria-hidden` needed. It reappears only in print.
    <div className="print-reports">
      {/* The printed document's root heading: `.app` (which holds the on-screen <h1>) is
          hidden in print, so without this the outline would start at <h2>. Visually hidden
          — the per-sheet <h2> titles carry the visible headers. */}
      <h1 className="visually-hidden">Stemma clinical print reports for {proband.name}</h1>
      {/* The running clinical-boundary footer (guardrail #3): `.print-footer` is
          `position: fixed`, so the browser repeats it at the bottom of every physical
          printed page regardless of where it sits in the DOM — placed here, before the
          sheets, rather than after them. A fixed element placed *after* the last
          `.print-sheet` still claims its own slot in normal flow at the point Chromium's
          paginator lays it out, which — even though the element paints nowhere near that
          slot — pushes a spurious blank trailing page onto the printed output. Placing it
          first avoids that: its flow slot lands before any content, so it never displaces
          the sheets after it. Verified by rendering to PDF; don't move this back to the
          end without re-checking for that trailing blank page. */}
      <footer className="print-footer" role="note">
        <b>Clinical boundary.</b> {CLINICAL_BOUNDARY_TEXT}
      </footer>
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
          Circle = woman · square = man · diamond = nonbinary (2022 gender-inclusive notation); sex
          assigned at birth (AFAB/AMAB/UAAB) is noted beneath a glyph when it differs. A shaded
          glyph is affected (coloured by condition category), a slash marks deceased, and the arrow
          marks {proband.name}.
        </p>
        {keyCats.length > 0 && (
          <ul className="print-catkey" role="list" aria-label="Condition category colour key">
            {keyCats.map((cat) => (
              <li key={cat} role="listitem">
                <span
                  className="print-catkey__swatch"
                  aria-hidden="true"
                  style={{ background: categoryColor(cat, palette) }}
                />
                {CATEGORY_LABELS[cat]}
              </li>
            ))}
          </ul>
        )}
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
                {affectedFindings.map((f) => {
                  const who = affectedLine(f, proband);
                  return (
                    <tr key={f.id}>
                      <td>
                        {f.name}
                        {who && <div className="print-affected">{who}</div>}
                      </td>
                      <td>{CATEGORY_LABELS[f.cat]}</td>
                      <td>{f.band}</td>
                      <td>{f.earliest != null ? f.earliest : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
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

        {allergyEntries.length > 0 && (
          <>
            <h3 className="print-subhead">Allergies &amp; intolerances</h3>
            <table className="print-table">
              <thead>
                <tr>
                  <th scope="col">Substance</th>
                  <th scope="col">Reaction</th>
                  <th scope="col">Severity</th>
                </tr>
              </thead>
              <tbody>
                {allergyEntries.map(({ event, substance, reaction, severity }) => (
                  <tr key={event.id}>
                    <td>{substance}</td>
                    <td>{reaction ?? '—'}</td>
                    <td>{severity ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {meds.length > 0 && (
          <>
            <h3 className="print-subhead">Current medications</h3>
            <table className="print-table">
              <thead>
                <tr>
                  <th scope="col">Medication</th>
                  <th scope="col">Dose</th>
                  <th scope="col">Since</th>
                </tr>
              </thead>
              <tbody>
                {meds.map(({ event, startYear }) => (
                  <tr key={event.id}>
                    <td>{event.title}</td>
                    <td>{event.med?.dose ?? '—'}</td>
                    <td>{startYear}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {immunizationEntries.length > 0 && (
          <>
            <h3 className="print-subhead">Immunizations</h3>
            <table className="print-table">
              <thead>
                <tr>
                  <th scope="col">Immunization</th>
                  <th scope="col">Dose</th>
                  <th scope="col">Year</th>
                </tr>
              </thead>
              <tbody>
                {immunizationEntries.map(({ event, vaccine, doseLabel, year }) => (
                  <tr key={event.id}>
                    <td>{vaccine ?? event.title}</td>
                    <td>{doseLabel ?? '—'}</td>
                    <td>{year}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
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
      </section>
    </div>
  );
}
