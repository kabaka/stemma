/**
 * iCalendar (RFC 5545) care-coordination export — the "put the next screen on your
 * calendar" surface (roadmap Phase 2).
 *
 * Unlike the whole-graph serialisers in this layer (FHIR / Phenopacket / GEDCOM / native
 * backup), this exporter is deliberately **root-scoped**: a screening schedule only makes
 * sense from one person's vantage — their organ inventory, their family signal, their age.
 * `native.ts` documents the same kind of intentional divergence for its own reason (it is
 * whole-graph *because* it is a lossless backup); this one is single-person *because* a
 * calendar is a personal artefact. It composes over {@link scheduleFor}, so all the
 * organ/family-signal/guardrail-#4 logic is reused, never re-derived.
 *
 * Advisory by construction (guardrail #2): every VEVENT is `STATUS:TENTATIVE`, the copy is
 * a prompt to discuss with a clinician, and no risk or consequence is stated or implied.
 * The shared {@link CLINICAL_BOUNDARY_TEXT} rides in every event description (guardrail #3).
 *
 * Pure and deterministic given its `now`/`asOfYear` arguments — no wall clock is read here.
 */
import type { FamilyRecord } from '@/domain/types';
import { scheduleFor, type ScheduleStatus } from '@/domain/screening';
import { CLINICAL_BOUNDARY_TEXT } from '@/domain/boundary';

/** RFC 5545 requires CRLF line breaks; a bare LF is rejected by strict parsers (Outlook). */
const CRLF = '\r\n';

export interface IcsExportOptions {
  /** ISO-8601 timestamp for the calendar's generation time (DTSTAMP source). */
  now: string;
  /** Reference year the schedule is resolved against (injected; never the wall clock). */
  asOfYear: number;
}

/**
 * Escape a TEXT property value per RFC 5545 §3.3.11: backslash, semicolon, comma and
 * newlines are the reserved characters. Order matters — backslash must be escaped first.
 */
function icsText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Fold a content line to ≤75 octets per RFC 5545 §3.1: overlong lines are split with
 * CRLF + a single leading space, which parsers unfold back into one logical line. Folds on
 * UTF-8 byte width and never splits a code point, so multi-byte names stay intact.
 */
function foldLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const chunks: string[] = [];
  let cur = '';
  let curBytes = 0;
  let first = true;
  for (const ch of line) {
    const chBytes = enc.encode(ch).length;
    // Continuation lines carry a leading space, so their content budget is one octet less.
    const limit = first ? 75 : 74;
    if (curBytes + chBytes > limit) {
      chunks.push(cur);
      cur = ch;
      curBytes = chBytes;
      first = false;
    } else {
      cur += ch;
      curBytes += chBytes;
    }
  }
  chunks.push(cur);
  return chunks.join(`${CRLF} `);
}

/**
 * Sanitise a value used inside a `UID` property. Person ids are internally generated
 * today (crypto UUIDs / a random slug), but a GEDCOM import derives ids from the file's
 * xref pointers (`src/import/gedcom.ts`), i.e. from untrusted input — so strip any CR/LF
 * and control characters defensively, ensuring a crafted id can never break the UID onto a
 * new line and forge an iCalendar property. A no-op for the ids Stemma generates itself.
 */
function icsUid(raw: string): string {
  // oxlint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f]/g, '');
}

/** Format an ISO-8601 timestamp as an RFC 5545 UTC date-time (`YYYYMMDDTHHMMSSZ`). */
function icsTimestamp(iso: string): string {
  const compact = iso.replace(/[-:]/g, '').replace(/\.\d+/, '');
  return compact.endsWith('Z') ? compact : `${compact}Z`;
}

/** Non-imperative, advisory phrasing for a schedule status (guardrail #2). */
function advisoryPhrase(status: ScheduleStatus): string {
  switch (status) {
    case 'overdue':
      return 'May be due based on typical guideline intervals — worth raising at your next visit';
    case 'due':
      return 'May be due this year — worth discussing with your clinician';
    // `notYet` screens are filtered out before export (see buildIcsCalendar), so only
    // `upToDate` reaches here in practice; both carry the neutral on-track phrasing.
    // Enumerated (no `default`) so a new ScheduleStatus can't silently fall through.
    case 'upToDate':
    case 'notYet':
      return 'On track per typical guideline interval';
  }
}

/**
 * Build an iCalendar document of upcoming/outstanding screens for `rootId`. Emits one
 * all-day VEVENT per scheduled screen that is due, overdue, or future-dated; a `notYet`
 * screen (root has not reached its start age) is omitted. An empty schedule still yields a
 * structurally valid, zero-VEVENT VCALENDAR — this never throws.
 */
export function buildIcsCalendar(
  record: FamilyRecord,
  rootId: string,
  opts: IcsExportOptions,
): string {
  const root = record.people.find((p) => p.id === rootId);
  const personName = root?.name ?? '';
  const dtstamp = icsTimestamp(opts.now);

  const scheduled = scheduleFor(record, rootId, opts.asOfYear).filter(
    (s) => s.nextDueYear !== null && s.scheduleStatus !== 'notYet',
  );

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Stemma//Care Coordination//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  for (const s of scheduled) {
    const year = s.nextDueYear as number; // filtered to non-null above.
    const description =
      `${s.why}. ${s.freq}. ${advisoryPhrase(s.scheduleStatus)}. ` +
      'Year due — exact date not tracked; schedule with your clinician.' +
      `\n\n${CLINICAL_BOUNDARY_TEXT}`;
    lines.push(
      'BEGIN:VEVENT',
      // Content-derived and stable, so re-exporting the same schedule is byte-identical.
      // ids are sanitised (icsUid) so an untrusted GEDCOM-derived id can't forge a property.
      `UID:${icsUid(rootId)}.${icsUid(s.id)}.${year}@stemma.local`,
      `DTSTAMP:${dtstamp}`,
      // All-day, year-only: the domain tracks a year, never a month/day — don't manufacture one.
      `DTSTART;VALUE=DATE:${year}0101`,
      // Advisory, not CONFIRMED (guardrail #2).
      'STATUS:TENTATIVE',
      `SUMMARY:${icsText(`Screening due: ${s.name} — ${personName}`)}`,
      `DESCRIPTION:${icsText(description)}`,
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join(CRLF)}${CRLF}`;
}
