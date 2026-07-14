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

    let text: string;
    try {
      text = await readFileText(file);
    } catch {
      setError('That file could not be read. Try exporting the GEDCOM again.');
      return;
    }

    const result = parseGedcom(text);
    if (!result.individuals.length) {
      setError(result.warnings[0] ?? 'No individuals were found in this file.');
      return;
    }
    setParsed(result);
    setProbandId(result.individuals[0].id);
  };

  const handleImport = (): void => {
    if (!parsed) return;
    const built = buildRecordFromGedcom(parsed, probandId);
    if (!built) {
      setError('There was nothing to import from this file.');
      return;
    }
    onImport(built);
  };

  const peopleCount = parsed?.individuals.length ?? 0;
  const familyCount = parsed?.families.length ?? 0;

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
          onChange={handleFile}
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

      {parsed && (
        <>
          <p role="status" style={{ fontSize: 13, margin: 0, lineHeight: 1.5 }}>
            Found <b>{peopleCount}</b> {peopleCount === 1 ? 'person' : 'people'} and{' '}
            <b>{familyCount}</b> {familyCount === 1 ? 'family' : 'families'}
            {fileName ? ` in ${fileName}` : ''}.
          </p>

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

          {parsed.warnings.length > 0 && (
            <div className="disclaimer" role="status">
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
        <button
          type="button"
          className="btn btn--primary btn--sm"
          onClick={handleImport}
          disabled={!parsed}
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
