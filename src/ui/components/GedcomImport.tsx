import { useId, useState, type ChangeEvent } from 'react';
import { buildRecordFromGedcom, parseGedcom, type ParsedGedcom } from '@/import';
import type { FamilyRecord } from '@/domain/types';

interface GedcomImportProps {
  /** Called with the built record once the user confirms; the parent owns the record swap
   * (and its "this replaces your record" confirmation), matching load-sample / reset. */
  onImport: (record: FamilyRecord) => void;
  onCancel: () => void;
}

/**
 * Read a file's text via `FileReader`. Preferred over `Blob.text()` for its wider support
 * (the latter isn't available in the jsdom test environment). Local-only — the bytes never
 * leave the browser.
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
 * Inline panel to seed the pedigree from a GEDCOM file (roadmap §3). The file is read and
 * parsed entirely in the browser — nothing is uploaded — then the user picks which imported
 * person is the record owner ("you") before loading. Structural import only: people and the
 * family graph, never conditions (a genealogy file carries none). Mirrors the AddRelative
 * card idiom rather than introducing a modal.
 */
export function GedcomImport({ onImport, onCancel }: GedcomImportProps) {
  const [parsed, setParsed] = useState<ParsedGedcom | null>(null);
  const [fileName, setFileName] = useState('');
  const [probandId, setProbandId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const fileId = useId();
  const probandFieldId = useId();

  const handleFile = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setParsed(null);
    setFileName(file.name);

    let result: ParsedGedcom;
    try {
      const text = await readFileText(file);
      // parseGedcom is written not to throw, but a hostile file shouldn't be able to break
      // the panel even if that contract ever slipped — fold any failure into an error.
      result = parseGedcom(text);
    } catch {
      setError('That file could not be read. Try exporting the GEDCOM again.');
      return;
    }

    if (!result.individuals.length) {
      setError(result.warnings[0] ?? 'No individuals were found in this file.');
      return;
    }
    setParsed(result);
    setProbandId(result.individuals[0].id);
  };

  const handleImport = (): void => {
    if (!parsed) return;
    let built;
    try {
      built = buildRecordFromGedcom(parsed, probandId);
    } catch {
      built = null;
    }
    if (!built) {
      setParsed(null); // clear the continuation UI so the error isn't shown alongside it
      setError('There was nothing to import from this file.');
      return;
    }
    onImport(built);
  };

  const peopleCount = parsed?.individuals.length ?? 0;
  const familyCount = parsed?.families.length ?? 0;
  const warningCount = parsed?.warnings.length ?? 0;

  return (
    <div className="card" style={{ marginBottom: 16, display: 'grid', gap: 14 }}>
      <div>
        <label className="lbl" htmlFor={fileId}>
          GEDCOM file (.ged)
        </label>
        <input
          id={fileId}
          className="field"
          type="file"
          accept=".ged,.gedcom,text/plain,application/x-gedcom"
          onChange={(e) => void handleFile(e)}
        />
        <p className="mono-dim" style={{ marginTop: 6 }}>
          Exported from Ancestry, FamilySearch, or another family-tree tool. Read in your browser —
          nothing is uploaded.
        </p>
      </div>

      {error && (
        <div className="disclaimer" role="alert">
          {error}
        </div>
      )}

      {/* A persistent polite live region: mounted from first render so the async parse
          result is announced when this text CHANGES, rather than being inserted into the
          DOM already populated (which some screen readers don't announce). */}
      <p role="status" style={{ fontSize: 13, margin: 0, lineHeight: 1.5, minHeight: 18 }}>
        {parsed && (
          <>
            Found <b>{peopleCount}</b> {peopleCount === 1 ? 'person' : 'people'} and{' '}
            <b>{familyCount}</b> {familyCount === 1 ? 'family' : 'families'}
            {fileName ? ` in ${fileName}` : ''}.
            {warningCount > 0 &&
              ` ${warningCount} ${warningCount === 1 ? 'entry was' : 'entries were'} adjusted (see below).`}
          </>
        )}
      </p>

      {parsed && (
        <>
          <div>
            <label className="lbl" htmlFor={probandFieldId}>
              Which of these is you? (the record owner)
            </label>
            <select
              id={probandFieldId}
              className="field"
              style={{ width: 'auto', maxWidth: '100%' }}
              value={probandId}
              onChange={(e) => setProbandId(e.target.value)}
            >
              {parsed.individuals.map((ind) => (
                <option key={ind.id} value={ind.id}>
                  {ind.name}
                  {ind.birth != null ? ` (b. ${ind.birth})` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Plain (non-live) box: the persistent status region above already announces
              the adjustment count, so this detail list doesn't need its own live role
              (two polite regions changing at once can drop one another). */}
          {warningCount > 0 && (
            <div className="disclaimer">
              <b>Some entries were adjusted:</b>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {parsed.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <p className="mono-dim" style={{ margin: 0 }}>
            Imports the family structure only. Health conditions aren&rsquo;t part of a genealogy
            file — add those in Stemma after importing. Sex assigned at birth comes from the file;
            gender defaults from it and is editable per person.
          </p>
        </>
      )}

      <div className="row">
        {/* aria-disabled (not the native `disabled` attribute) so keyboard / screen-reader
            users can still reach the control and learn it exists before a file has parsed;
            handleImport no-ops while `parsed` is null. */}
        <button
          type="button"
          className="btn btn--primary btn--sm"
          onClick={handleImport}
          aria-disabled={!parsed}
        >
          Import family
        </button>
        <button type="button" className="btn btn--sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
