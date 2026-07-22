/**
 * Printable clinical one-pagers — the "bring it to your appointment" surface
 * (roadmap §2, GAP-ANALYSIS H1). Restores the three sheets the prototype printed:
 *
 *  1. A three-generation NSGC pedigree (reusing the SVG export).
 *  2. A family-history red-flag summary — the detected patterns + per-condition findings
 *     that actually cluster in the family. A proband-only diagnosis (no affected relative)
 *     no longer gets a row in this sheet's "Conditions in the family" table — it still
 *     prints in full on Sheet 3's own Conditions table, so nothing is lost, just not
 *     duplicated. (`f.rec` — the pattern's advisory recommendation text — is unrelated to
 *     this dedup: it only ever renders in the flags loop above, never in that table.)
 *  3. An IPS-style personal-health summary for the record owner, including a "Labs &
 *     vitals" section (latest value, reference range as recorded, reading count and span
 *     per series — no min/max). The latest value DOES carry a strictly positional "above
 *     range"/"below range" restatement of that same reading's own recorded bounds, via
 *     {@link RangePositionMark}/`rangePosition` (DR-0036) — never a clinical interpretation,
 *     severity, or colour-only signal (guardrail #1); see the print-note above the table.
 *     The Health timeline table
 *     below it excludes a structured lab/vital measurement event ONLY when it carries no
 *     free-text `detail` note — its value is already faithfully summarised in "Labs &
 *     vitals" instead of a generic Year/Type/Event row. A structured measurement that DOES
 *     carry a `detail` note is kept in the timeline (shown with its value inline) so that
 *     clinician-relevant free text — "fasting", "drawn post-exercise", a transcribed lab
 *     comment — is never silently dropped from the printout (guardrail #1: restate
 *     recorded facts faithfully). Unstructured lab/vital events, whose value is spelled
 *     out in the title, still appear there as before.
 *
 * Rendered once as a sibling of the app shell (see App.tsx) and hidden on screen; the
 * `@media print` stylesheet hides the dark app chrome and reveals these black-on-white
 * sheets, one per page. The clinical boundary (guardrail #3) is a HYBRID of two
 * mechanisms, each doing only the one thing it's good at — see the inline comment above
 * `.print-footer` below for the full rationale:
 *  - A `position: fixed` `.print-footer` PINS the visible boundary text to the bottom of
 *    every physical page, including a short record, a single-page print, or the last page
 *    of a multi-page print — cases where a `<tfoot>` alone floats up right after the
 *    content instead of reaching the page bottom (the regression this hybrid fixes).
 *  - An invisible, fixed-height `<tfoot>` SPACER (no boundary text) reserves that same
 *    height in normal flow on every page the `.print-doc` table spans, which is what stops
 *    the fixed footer from painting over flowed content — the occlusion bug a bare
 *    `position: fixed` footer caused previously (table rows, and once a table's own header
 *    row, rendered behind/under it no matter how much `@page` margin was budgeted).
 *
 * Presentational only: it reads the proband's computed engine outputs (never re-deriving
 * a number the engine didn't produce, guardrail #1) and renders them.
 */
import { useStore } from '@/store/useStore';
import { useAsOfYear, useCatalog, useFindings, useFlags, useScreenings } from '../hooks';
import { buildPedigreeSvg, windowedPeople } from '@/export';
import { ORGAN_LABELS, ageOf, condEntry, genderLabel, organsOf, sabLabel } from '@/domain/person';
import {
  allergies,
  currentMedications,
  immunizations,
  measurementSummaries,
  rangePosition,
} from '@/domain/timeline';
import { RangePositionMark } from './RangePositionMark';
import { CATEGORY_LABELS, categoryColor, legendCategories } from '@/data/categories';
import { EVENT_META } from '@/data/events';
import { PROV_LABEL } from '@/data/provenance';
import { SEVERITY_META } from '@/data/severity';
import { CLINICAL_BOUNDARY_TEXT } from '@/domain/boundary';
import type { FamilyFinding } from '@/domain/patterns';
import type { MeasurementSeriesSummary } from '@/domain/timeline';
import type { Person, TimelineEvent } from '@/domain/types';

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

/** Presentational recency-first order for the "Labs & vitals" summary rows: most
 * recently-sampled series first, ties broken alphabetically by test name — the domain
 * read-model returns first-seen order, sorting for display is this component's job. */
function byRecency(a: MeasurementSeriesSummary, b: MeasurementSeriesSummary): number {
  return b.latestYear - a.latestYear || a.title.localeCompare(b.title);
}

/** `refLow`/`refHigh` restated exactly as recorded, as plain text — this column itself
 * carries no in/out-of-range marking; the marker lives on the value cell instead, via
 * {@link RangePositionMark} (DR-0036), and is neutral/colour-independent there too
 * (guardrail #1). */
function referenceRange(s: MeasurementSeriesSummary): string {
  if (s.refLow === undefined && s.refHigh === undefined) return '—';
  return `${s.refLow ?? '—'}–${s.refHigh ?? '—'} ${s.latestUnit}`;
}

function measurementYears(s: MeasurementSeriesSummary): string {
  return s.firstYear === s.latestYear ? `${s.firstYear}` : `${s.firstYear}–${s.latestYear}`;
}

/** Event-cell text for one Health timeline row. A structured lab/vital measurement kept
 * in the timeline (it carries a `detail` note — see the `timeline` filter below) has no
 * value spelled out in its title the way a generic event does, so it's rendered with its
 * recorded value inline (`Title: value unit`) plus the note; every other event renders
 * its title plus an em-dash-joined detail exactly as before. Pure function of the event —
 * no wall clock, no engine recomputation (guardrail #1: only restates the recorded
 * `Measurement`, never a derived number). */
function eventCellText(e: TimelineEvent): string {
  const m = e.lab ?? e.vital;
  if (m) {
    return `${e.title}: ${m.value} ${m.unit}${e.detail ? ` — ${e.detail}` : ''}`;
  }
  return `${e.title}${e.detail ? ` — ${e.detail}` : ''}`;
}

/** One Labs-or-Vitals sub-table of the "Labs & vitals" summary; renders nothing for an
 * empty series list so the caller can unconditionally place both Labs and Vitals blocks. */
function MeasurementTable({
  caption,
  rows,
}: {
  caption: string;
  rows: MeasurementSeriesSummary[];
}) {
  if (rows.length === 0) return null;
  return (
    <table className="print-table">
      <caption className="print-subhead--minor">{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Test</th>
          <th scope="col">Latest</th>
          <th scope="col">Reference range (as recorded)</th>
          <th scope="col">Readings</th>
          <th scope="col">Years</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s) => (
          <tr key={`${s.type}-${s.title}`}>
            <td>{s.title}</td>
            <td>
              {s.latestValue} {s.latestUnit}{' '}
              <span className="print-affected">({s.latestYear})</span>
              <RangePositionMark position={rangePosition(s.latestValue, s.refLow, s.refHigh)} />
            </td>
            <td>{referenceRange(s)}</td>
            <td>{s.count}</td>
            <td>{measurementYears(s)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
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
  // Family-clustered conditions only (Sheet 2); a proband-only diagnosis with no
  // affected relatives now lives solely in Sheet 3's own "Conditions" table instead of
  // duplicating it here. A condition that is both family-clustered and proband-diagnosed
  // still qualifies via `affCount > 0`, and `affectedLine` still surfaces the "You" entry.
  const affectedFindings = findings.filter((f) => f.affCount > 0);
  // The Health timeline lists generic events (visit/diagnosis/procedure/…) by title; a
  // structured lab/vital event's value lives in its `lab`/`vital` Measurement payload, not
  // its title, and gets its own faithful summary in "Labs & vitals" below instead — a
  // note-less structured measurement is dropped from this table (it would otherwise show
  // with no value, and often number in the hundreds). But a structured measurement can
  // ALSO carry a free-text `detail` note (e.g. "fasting", a transcribed lab comment) that
  // "Labs & vitals" has no room to show per-reading — dropping the row would silently lose
  // that note (guardrail #1). So only a NOTE-LESS structured measurement is excluded here;
  // one with a non-empty `detail` is kept, rendered with its value via `eventCellText`.
  // Unstructured lab/vital events (value spelled out in the title, no payload) were never
  // affected by any of this and are kept as before.
  const timeline = proband
    ? record.timeline
        .filter(
          (e) =>
            e.person === proband.id &&
            !(
              ((e.type === 'lab' && e.lab) || (e.type === 'vital' && e.vital)) &&
              !e.detail?.trim()
            ),
        )
        .slice()
        .sort((a, b) => b.year - a.year)
    : [];

  if (!proband) return null;
  const organs = organsOf(proband);
  const meds = currentMedications(record, proband.id, asOfYear);
  const allergyEntries = allergies(record, proband.id);
  const immunizationEntries = immunizations(record, proband.id);
  const labs = measurementSummaries(record, proband.id, 'lab').slice().sort(byRecency);
  const vitals = measurementSummaries(record, proband.id, 'vital').slice().sort(byRecency);

  return (
    // Hidden on screen via `display:none` (see components.css), which already removes it
    // from the accessibility tree — no `aria-hidden` needed. It reappears only in print.
    <div className="print-reports">
      {/* The VISIBLE half of the hybrid clinical-boundary footer (guardrail #3):
          `position: fixed; bottom: 0`, which is what PINS it to the bottom of every
          physical printed page — including a short record, a single-page print, or the
          last page of a multi-page print, where the `<tfoot>` spacer below (which only
          reserves in-flow space) floats up right after the content instead of reaching the
          page bottom on its own. Deliberately placed FIRST in the DOM, before the
          `.print-doc` table and even before the root `<h1>` below: a fixed element placed
          AFTER the sheets caused a spurious trailing blank page in Chromium's print
          pagination (empirically verified via PDF render), whereas first-in-DOM does not.
          Its `height` is one half of a coupled invariant with `.print-doc__foot-spacer`'s
          `height` in components.css — see the comment there for the full hybrid rationale
          and why both are needed together (this half alone repaints over flowed content;
          the spacer alone doesn't reach the page bottom on a short/last page). */}
      <div className="print-footer" role="note">
        <b>Clinical boundary.</b> {CLINICAL_BOUNDARY_TEXT}
      </div>
      {/* The printed document's root heading: `.app` (which holds the on-screen <h1>) is
          hidden in print, so without this the outline would start at <h2>. Visually hidden
          — the per-sheet <h2> titles carry the visible headers. */}
      <h1 className="visually-hidden">Stemma clinical print reports for {proband.name}</h1>
      {/* The IN-FLOW half of the hybrid footer: an invisible, fixed-height spacer — no
          boundary text — repeated per page as a `<tfoot>` running table footer. It reserves
          the same `height` as `.print-footer` above at the bottom of every page the table
          spans, which is what stops the fixed footer from painting over flowed content (the
          occlusion bug a bare `position: fixed` footer caused: table rows, and once a
          table's own header row, rendered behind/under it no matter how much `@page` margin
          was budgeted for it — because a fixed element is positioned against the content
          box and painted after normal flow, not reserved space within it).
          Chromium's per-page `<tfoot>` repetition needs row-level fragmentation to engage:
          repeated rendering via isolated repro (see `PrintReports.tsx` git history / PR
          notes) showed a `<tfoot>` repeats on every page when the `<tbody>` breaks across
          pages at `<tr>` boundaries — even if one of those rows itself internally overflows
          across many further pages — but prints ONLY ONCE, on the table's true last page,
          when the whole document is a single `<tr>` whose one `<td>` happens to contain
          everything. That's why each `.print-sheet` below still gets its OWN `<tr>`/`<td>`
          rather than sharing one: with three sibling rows, the tbody genuinely fragments at
          row boundaries and the spacer repeats (reserving its band) on every page,
          including the many further pages Sheet 3 alone spans internally. Each sheet still
          starts on a fresh page — but that forced break lives on the `<tr>` itself in CSS
          (`.print-doc > tbody > tr { break-before: page }`), NOT on `.print-sheet`: a
          `break-after: page` on the sheet `<div>` was silently ignored (no next flow
          sibling within its own `<td>` for the break to push, and the request didn't
          propagate across the row boundary to the next `<tr>`), while `break-before: page`
          on the row itself is what Chromium actually honors, and it composes cleanly with
          the per-page spacer repetition rather than fighting it.
          Verified by rendering to PDF at Letter and A4 with a table-dense record reaching
          every page bottom, AND with minimal isolated repros (single-`<tr>` vs. multi-`<tr>`
          tables; `break-after` on the cell content vs. `break-before` on the row) to confirm
          this is Chromium's actual fragmentation behaviour, not an artifact of this app's
          other CSS — re-verify the same way if this structure changes. */}
      <table className="print-doc" role="presentation">
        <tfoot className="print-doc__foot">
          <tr>
            <td>
              <div className="print-doc__foot-spacer" aria-hidden="true" />
            </td>
          </tr>
        </tfoot>
        <tbody>
          <tr>
            <td>
              {/* Sheet 1 — three-generation pedigree — own `<tr>` (see the `<tfoot>`
                  comment above: three sibling rows is what makes the footer repeat on
                  every page, not just the last one). */}
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
                  Circle = woman · square = man · diamond = nonbinary (2022 gender-inclusive
                  notation); sex assigned at birth (AFAB/AMAB/UAAB) is noted beneath a glyph when it
                  differs. A shaded glyph is affected (coloured by condition category), a slash
                  marks deceased, and the arrow marks {proband.name}.
                </p>
                {keyCats.length > 0 && (
                  <ul
                    className="print-catkey"
                    role="list"
                    aria-label="Condition category colour key"
                  >
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
            </td>
          </tr>
          <tr>
            <td>
              {/* Sheet 2 — family-history red-flag summary — own `<tr>`, see above. */}
              <section className="print-sheet">
                <SheetHead
                  title="Family-history red-flag summary"
                  subtitle={`Detected patterns from ${proband.name}’s vantage, each citing the criterion met`}
                />
                {flags.length === 0 ? (
                  <p className="print-empty">
                    No red-flag family patterns detected. A limited history is not the same as low
                    risk — keep the record current.
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
            </td>
          </tr>
          <tr>
            <td>
              {/* Sheet 3 — IPS-style personal-health summary — own `<tr>`, see above. This
                  is the row that itself internally overflows across many further pages in
                  a dense record (Sheet 3 alone can span several physical pages) — the repro
                  confirmed a `<tfoot>` still repeats correctly for those internal pages too,
                  as long as it's a sibling row rather than the table's only row. */}
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
                  <p className="print-empty">
                    No screening recommendations from the current record.
                  </p>
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

                {(labs.length > 0 || vitals.length > 0) && (
                  <>
                    <h3 className="print-subhead">Labs &amp; vitals</h3>
                    <p className="print-note">
                      Values and reference ranges are shown exactly as recorded from your own
                      reports. A value marked <em>above range</em> or <em>below range</em> falls
                      outside the reference range you recorded — a factual comparison, not a
                      clinical assessment of whether the value is normal. Reference ranges depend on
                      the lab, method, age and sex; discuss results with a clinician.
                    </p>
                    <MeasurementTable caption="Labs" rows={labs} />
                    <MeasurementTable caption="Vitals" rows={vitals} />
                  </>
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
                            <td>{EVENT_META[e.type].label}</td>
                            <td>{eventCellText(e)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
              </section>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
