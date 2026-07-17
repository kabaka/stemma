import { useId, useState, type ChangeEvent } from 'react';
import { applyCcdaImport, parseCcda, stageCcdaImport, type StagedCcdaImport } from '@/import';
import type { CcdaSelections } from '@/import';
import { useDisclosureFocus } from '../hooks';
import { CcdaReview } from './CcdaReview';
import type { Catalog } from '@/domain/catalog';
import type { Condition, FamilyRecord } from '@/domain/types';

interface CcdaImportProps {
  /** A snapshot of the live record + catalog to reconcile against — taken from the
   * parent so this panel never has to read the store itself (matches the read-only,
   * props-in shape of GedcomImport/NativeRestore). */
  record: FamilyRecord;
  catalog: Catalog;
  /** Called with the merged record + any newly-registered long-tail extensions once the
   * user confirms in the review step. The parent owns the store write (`replaceRecord`)
   * and its own "this changes your record" confirmation, matching the other importers —
   * but worded for a MERGE here, not a replace: nothing already in the record is removed. */
  onImport: (record: FamilyRecord, extensions: Condition[]) => void;
  onCancel: () => void;
}

/**
 * Read a file's text via `FileReader` — wider support than `Blob.text()` (jsdom lacks the
 * latter). Local-only: the bytes never leave the browser. Duplicated from GedcomImport/
 * NativeRestore rather than shared, matching how those two already each keep their own copy.
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
 * Inline panel to import a C-CDA (CCD) — the patient-record download every certified US
 * EHR portal offers ("Download my record" / "View, Download, Transmit") — carrying the
 * patient's own problem list and family history. The file is read and parsed entirely in
 * the browser — nothing is uploaded — then staged against the live record and handed to
 * {@link CcdaReview} for an explicit, item-by-item accept/override before anything is
 * merged in. Unlike GEDCOM/native-backup import (which replace the whole record),
 * this one only ever adds to it: existing people and conditions are never removed.
 */
export function CcdaImport({ record, catalog, onImport, onCancel }: CcdaImportProps) {
  const [staged, setStaged] = useState<StagedCcdaImport | null>(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const fileId = useId();
  const hintId = useId();
  const fileRef = useDisclosureFocus<HTMLInputElement>();

  const handleFile = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    setError(null);
    setStaged(null);
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

    // parseCcda is written not to throw (every failure mode returns an empty result plus
    // a structured warning), but a hostile/unexpected file shouldn't be able to break this
    // panel even if that contract ever slipped — fold any failure into the same error path.
    let parsed;
    try {
      parsed = parseCcda(text);
    } catch {
      setError('This file could not be parsed as a C-CDA document.');
      return;
    }

    if (parsed.proband.problems.length === 0 && parsed.familyMembers.length === 0) {
      setError(parsed.warnings[0] ?? 'No problems or family history were found in this document.');
      return;
    }

    setStaged(stageCcdaImport(parsed, record, catalog));
  };

  const handleConfirm = (selections: CcdaSelections): void => {
    if (!staged) return;
    const { record: merged, extensions } = applyCcdaImport(record, staged, selections, catalog);
    onImport(merged, extensions);
  };

  return (
    <div className="card" style={{ marginBottom: 16, display: 'grid', gap: 14 }}>
      <div>
        <label className="lbl" htmlFor={fileId}>
          Health record (C-CDA / CCD, .xml)
        </label>
        <input
          ref={fileRef}
          id={fileId}
          className="field"
          type="file"
          accept=".xml,text/xml,application/xml"
          aria-describedby={hintId}
          onChange={(e) => void handleFile(e)}
        />
        <p id={hintId} className="mono-dim" style={{ marginTop: 6 }}>
          A Continuity of Care Document from your patient portal (often labelled “Download my
          record” or “View, Download, Transmit”). Parsed entirely in your browser — nothing is
          uploaded. Adds your conditions and family history to your current record; nothing already
          recorded is removed.
        </p>
      </div>

      {error && (
        <div className="disclaimer" role="alert">
          {error}
        </div>
      )}

      {/* Persistent polite live region so the async parse result is announced on change,
          rather than inserted into the DOM already populated (some screen readers don't
          announce that). */}
      <p role="status" style={{ fontSize: 13, margin: 0, lineHeight: 1.5, minHeight: 18 }}>
        {staged && (
          <>
            Found <b>{staged.probandConditions.length}</b>{' '}
            {staged.probandConditions.length === 1 ? 'condition' : 'conditions'} and{' '}
            <b>{staged.familyMembers.length}</b>{' '}
            {staged.familyMembers.length === 1 ? 'family member' : 'family members'}
            {fileName ? ` in ${fileName}` : ''}.
          </>
        )}
      </p>

      {staged ? (
        <CcdaReview staged={staged} record={record} onConfirm={handleConfirm} onCancel={onCancel} />
      ) : (
        <div className="row">
          <button type="button" className="btn btn--sm" onClick={onCancel}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
