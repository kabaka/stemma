import { useRef, useState } from 'react';
import { useHistoryStore } from '@/store/useHistoryStore';
import { diffRecords, summarizeDiff, type HistoryEntry } from '@/domain/history';

const CONFIRM_CLEAR =
  "Clear all recorded history? This only erases Stemma's edit-audit log — your family record itself is untouched — and cannot be undone.";

/**
 * Stemma's own edit-audit trail — every history-worthy mutation to the record, newest
 * first, each expandable to a plain-language "what changed" diff against the entry
 * immediately before it.
 *
 * No <ClinicalBoundary/> here (confirmed with clinical-safety review): this view shows
 * the app's own change log, not a clinical-analysis surface — it computes no pattern, no
 * risk, no advice. Restore-to-past is intentionally out of scope; this is view-only.
 */
export function HistoryView() {
  // Select the array reference itself (stable unless entries actually change) rather
  // than deriving a fresh array/object in the selector, so this component doesn't
  // re-render on every unrelated store tick.
  const entries = useHistoryStore((s) => s.entries);
  const clear = useHistoryStore((s) => s.clear);

  // `entries` is chronological (oldest first); the view wants newest first.
  const newestFirst = [...entries].reverse();

  // "Clear history" only renders while entries.length > 0 (below), so it unmounts itself
  // the moment it's activated — with nothing else done, keyboard/AT focus would silently
  // drop to <body> (WCAG 2.4.3). The page's own <h1> already carries tabIndex={-1} for
  // App's per-navigation focus pattern; reuse it as the stable post-clear landing target.
  const titleRef = useRef<HTMLHeadingElement>(null);

  const handleClear = (): void => {
    if (window.confirm(CONFIRM_CLEAR)) {
      clear();
      titleRef.current?.focus();
    }
  };

  return (
    <div className="scroll">
      <div className="page-head">
        <h1 className="page-title" tabIndex={-1} ref={titleRef}>
          History
        </h1>
        {entries.length > 0 && (
          <button type="button" className="btn btn--sm btn--danger" onClick={handleClear}>
            Clear history
          </button>
        )}
      </div>
      <p className="lede">
        A running log of edits to your family record — newest first. This is Stemma&rsquo;s own
        change log, kept separately from the record itself; it never leaves your browser and
        restoring a past version is not yet supported.
      </p>
      {/* Append-only means "delete" doesn't mean what it looks like elsewhere: removing a
          person/condition/event only takes it out of the CURRENT record — the pre-delete
          snapshot still lives here until the log itself is cleared (guardrail #5, private
          by default — a promise this log can quietly break without this disclosure). */}
      <p className="mono-dim" style={{ margin: '0 0 20px' }}>
        Deleting something from your record removes it from the current record but not from this log
        — use Clear history to fully remove it from this device.
      </p>

      {entries.length === 0 ? (
        // role="status": a polite live region so the empty state (including right after
        // Clear history fires) is announced to AT, not just focused (WCAG 4.1.3).
        <div className="card" role="status" style={{ color: 'var(--text-dim)' }}>
          No changes recorded yet. Your edits will appear here.
        </div>
      ) : (
        <>
          <h2 className="section-label">Edit log</h2>
          <ul
            className="plain-list"
            role="list"
            aria-label="Edit history, newest first"
            style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
          >
            {newestFirst.map((entry, i) => {
              // `entries` is chronological, so the entry immediately BEFORE this one there
              // (index - 1) is its predecessor for diffing — not `newestFirst[i + 1]`,
              // which is the same person but easy to get backwards; deriving the index
              // from the chronological array keeps that unambiguous.
              const chronoIndex = entries.length - 1 - i;
              const previous = chronoIndex > 0 ? entries[chronoIndex - 1] : null;
              return <HistoryRow key={entry.id} entry={entry} previous={previous} />;
            })}
          </ul>
        </>
      )}
    </div>
  );
}

interface HistoryRowProps {
  entry: HistoryEntry;
  /** The chronologically-earlier entry to diff against, or null for the oldest entry
   * Stemma retained (no predecessor to diff against). */
  previous: HistoryEntry | null;
}

/** One entry: a timestamp + label summary, expandable to its "what changed" diff. The
 * diff itself is only computed when the entry is actually open (a <details> is present
 * in the DOM either way, but the expensive diffRecords/summarizeDiff call is skipped
 * until the user asks for it — a 50-entry log full-diffing eagerly would otherwise
 * recompute this on every render for rows nobody ever opens). */
function HistoryRow({ entry, previous }: HistoryRowProps) {
  const [open, setOpen] = useState(false);

  const lines = open && previous ? summarizeDiff(diffRecords(previous.record, entry.record)) : null;

  const timestamp = new Date(entry.ts).toLocaleString();

  return (
    <li className="card" role="listitem" style={{ padding: 0 }}>
      <details className="history-entry__details" onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className="history-entry__summary">
          <span className="mono-dim" style={{ flex: 'none' }}>
            {timestamp}
          </span>
          <span className="history-entry__summary-label" style={{ fontSize: 13, fontWeight: 600 }}>
            {entry.label}
          </span>
        </summary>
        {open &&
          (previous === null ? (
            <p className="history-entry__diff">
              Diff unavailable — this is the oldest change Stemma retained.
            </p>
          ) : lines && lines.length === 0 ? (
            <p className="history-entry__diff">No field-level changes</p>
          ) : (
            <ul className="plain-list history-entry__diff" role="list" aria-label="What changed">
              {lines?.map((line, idx) => (
                <li key={idx} role="listitem">
                  {line}
                </li>
              ))}
            </ul>
          ))}
      </details>
    </li>
  );
}
