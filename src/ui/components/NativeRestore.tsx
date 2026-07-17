import { useId, useState, type ChangeEvent } from 'react';
import { parseNativeBackup } from '@/import';
import { useDisclosureFocus } from '../hooks';
import type { Condition, FamilyRecord } from '@/domain/types';

interface NativeRestoreProps {
  /** Called with the restored record + extensions once the user confirms; the parent owns
   * the record swap and its "this replaces your record" confirmation (matches GEDCOM import). */
  onRestore: (record: FamilyRecord, extensions: Condition[]) => void;
  onCancel: () => void;
}

/**
 * Read a file's text via `FileReader` — wider support than `Blob.text()` (jsdom lacks the
 * latter). Local-only: the bytes never leave the browser.
 */
function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
    reader.readAsText(file);
  });
}

/**
 * Inline panel to restore a complete record from a Stemma native backup (GAP-ANALYSIS H2).
 * The file is read and validated entirely in the browser — nothing is uploaded — then the
 * user confirms the swap. Lossless counterpart to the GEDCOM importer, which is structural-
 * only. Mirrors the GedcomImport idiom rather than introducing a modal.
 */
export function NativeRestore({ onRestore, onCancel }: NativeRestoreProps) {
  const [pending, setPending] = useState<{
    record: FamilyRecord;
    extensions: Condition[];
  } | null>(null);
  const [fileName, setFileName] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const fileId = useId();
  const hintId = useId();
  // Focus the file input on open; hand focus back to the trigger button on close.
  const fileRef = useDisclosureFocus<HTMLInputElement>();

  const handleFile = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    setError(null);
    setPending(null);
    setWarnings([]);
    setFileName(file.name);
    // Clear the input's value so re-selecting the *same* file after fixing it still fires
    // a change event (browsers suppress it when the chosen path is unchanged).
    input.value = '';

    let text: string;
    try {
      text = await readFileText(file);
    } catch {
      setError('That file could not be read.');
      return;
    }

    const result = parseNativeBackup(text);
    if (!result.data) {
      setError(result.warnings[0] ?? 'That file is not a Stemma backup.');
      return;
    }
    setPending(result.data);
    setWarnings(result.warnings);
  };

  const peopleCount = pending?.record.people.length ?? 0;
  const eventCount = pending?.record.timeline.length ?? 0;

  return (
    <div className="card" style={{ marginBottom: 16, display: 'grid', gap: 14 }}>
      <div>
        <label className="lbl" htmlFor={fileId}>
          Stemma backup file (.json)
        </label>
        <input
          ref={fileRef}
          id={fileId}
          className="field"
          type="file"
          accept=".json,application/json"
          aria-describedby={hintId}
          onChange={(e) => void handleFile(e)}
        />
        <p id={hintId} className="mono-dim" style={{ marginTop: 6 }}>
          A file you previously downloaded with “Download backup”. Read and validated in your
          browser — nothing is uploaded.
        </p>
      </div>

      {error && (
        <div className="disclaimer" role="alert">
          {error}
        </div>
      )}

      {/* Persistent polite live region so the async validation result is announced on change. */}
      <p role="status" style={{ fontSize: 13, margin: 0, lineHeight: 1.5, minHeight: 18 }}>
        {pending && (
          <>
            Ready to restore <b>{peopleCount}</b> {peopleCount === 1 ? 'person' : 'people'} and{' '}
            <b>{eventCount}</b> timeline {eventCount === 1 ? 'event' : 'events'}
            {fileName ? ` from ${fileName}` : ''}.
          </>
        )}
      </p>

      {pending && warnings.length > 0 && (
        <div className="disclaimer">
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="row">
        {/* aria-disabled (not `disabled`) so keyboard / SR users can reach the control and
            learn it exists before a file has parsed; the handler no-ops while pending is null. */}
        <button
          type="button"
          className="btn btn--primary btn--sm"
          onClick={() => pending && onRestore(pending.record, pending.extensions)}
          aria-disabled={!pending}
          aria-describedby={pending ? undefined : hintId}
        >
          Restore this backup
        </button>
        <button type="button" className="btn btn--sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
