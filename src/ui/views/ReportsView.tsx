import { useState } from 'react';
import { useStore } from '@/store/useStore';
import { useAsOfYear, useCatalog } from '../hooks';
import {
  buildFhirBundle,
  buildGedcom,
  buildIcsCalendar,
  buildNativeBackup,
  buildPedigreeSvg,
  buildPhenopacket,
} from '@/export';
import { NativeRestore } from '../components/NativeRestore';
import { ClinicalBoundary } from '../components/ClinicalBoundary';
import type { Condition, FamilyRecord } from '@/domain/types';

const CONFIRM_RESTORE =
  'Restore this backup? It replaces your current record, timeline, and custom conditions.';

type Format = 'fhir' | 'phenopacket' | 'gedcom' | 'svg' | 'ics';

interface ExportSpec {
  id: Format;
  name: string;
  standard: string;
  desc: string;
  filename: string;
  mime: string;
}

const EXPORTS: ExportSpec[] = [
  {
    id: 'fhir',
    name: 'FHIR bundle',
    standard: 'HL7 FHIR R4',
    desc: 'Patient + Condition + FamilyMemberHistory for a portal or EHR.',
    filename: 'stemma-family.fhir.json',
    mime: 'application/fhir+json',
  },
  {
    id: 'phenopacket',
    name: 'Phenopacket',
    standard: 'GA4GH Phenopacket v2',
    desc: 'Pedigree + phenotypes for a genetic counselor or research.',
    filename: 'stemma-family.phenopacket.json',
    mime: 'application/json',
  },
  {
    id: 'gedcom',
    name: 'GEDCOM',
    standard: 'GEDCOM 5.5.1',
    desc: 'Family structure for genealogy tools (Ancestry, FamilySearch).',
    filename: 'stemma-family.ged',
    mime: 'text/plain',
  },
  {
    id: 'svg',
    name: 'Pedigree chart',
    standard: 'SVG · 2022 NSGC notation',
    desc: 'Three-generation pedigree in gender-inclusive nomenclature.',
    filename: 'stemma-pedigree.svg',
    mime: 'image/svg+xml',
  },
  {
    id: 'ics',
    name: 'Screening calendar',
    standard: 'iCalendar · RFC 5545',
    desc: 'Upcoming and outstanding screens for the current risk vantage — unlike the exports above, this one covers a single person, not the whole record.',
    filename: 'stemma-screenings.ics',
    mime: 'text/calendar',
  },
];

function download(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/** Export the record to open, no-lock-in standards. Everything is generated client-side. */
export function ReportsView() {
  const record = useStore((s) => s.record);
  const extensions = useStore((s) => s.extensions);
  const palette = useStore((s) => s.palette);
  const replaceRecord = useStore((s) => s.replaceRecord);
  // The .ics export is vantage-scoped (unlike every other export here, which is
  // whole-graph) — it needs the current risk root to know whose calendar to build.
  const riskRoot = useStore((s) => s.riskRoot);
  const catalog = useCatalog();
  const asOfYear = useAsOfYear();
  const [preview, setPreview] = useState<{ format: Format; text: string } | null>(null);
  const [restoring, setRestoring] = useState(false);

  const rootName = record.people.find((p) => p.id === riskRoot)?.name ?? 'the current vantage';

  const downloadBackup = (): void => {
    // The generation timestamp is injected here (the sanctioned wall-clock boundary) so the
    // serialiser stays pure. Extensions ride along so the long-tail catalog round-trips too.
    const text = buildNativeBackup(record, extensions, { now: new Date().toISOString() });
    download('stemma-backup.json', text, 'application/json');
  };

  const handleRestore = (restored: FamilyRecord, restoredExt: Condition[]): void => {
    if (window.confirm(CONFIRM_RESTORE)) {
      replaceRecord(restored, restoredExt);
      setRestoring(false);
    }
  };

  const render = (format: Format): string => {
    // The document's generation time and as-of year are injected here (the sanctioned
    // wall-clock boundary) so the serializers stay pure/deterministic.
    const now = new Date().toISOString();
    switch (format) {
      case 'fhir':
        return JSON.stringify(buildFhirBundle(record, catalog, { now }), null, 2);
      case 'phenopacket':
        return JSON.stringify(buildPhenopacket(record, catalog, { now, asOfYear }), null, 2);
      case 'gedcom':
        return buildGedcom(record);
      case 'svg':
        return buildPedigreeSvg(record, catalog, { palette });
      case 'ics':
        return buildIcsCalendar(record, riskRoot, { now, asOfYear });
    }
  };

  return (
    <div className="scroll">
      <div className="page-head">
        <h1 className="page-title" tabIndex={-1}>
          Reports &amp; Export
        </h1>
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => window.print()}
          title="Print three clinician-ready sheets: pedigree, red-flag summary, and personal health summary"
        >
          Print clinical sheets
        </button>
      </div>
      {/* The live SVG/FHIR/Phenopacket preview below is an analysis surface like any
          other — every such surface restates the boundary (guardrail #3). */}
      <ClinicalBoundary />
      <p className="lede">
        Your record is yours. Everything below is generated in your browser and exports to an open
        standard, so the data outlives the app. Nothing is uploaded.
      </p>

      <section style={{ marginBottom: 24 }}>
        <h2 className="section-label">Backup &amp; restore</h2>
        {/* The honest at-rest caveat (previously only in README/ARCHITECTURE) — stated
            here, next to the controls that write and read that storage. */}
        <p className="mono-dim" style={{ margin: '0 0 10px' }}>
          Stored unencrypted in this browser&rsquo;s local storage — readable by anyone with access
          to this device or profile. Your edit history (Stemma → History) also keeps past snapshots
          on this device until you clear it.
        </p>
        <div className="card">
          <h3 style={{ fontWeight: 600, fontSize: 14 }}>Full-record backup (Stemma JSON)</h3>
          <div className="mono-dim" style={{ margin: '3px 0 9px' }}>
            Lossless · versioned
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.5 }}>
            The complete record — everyone, their conditions with onset and provenance, the
            timeline, organ inventories, identity, and any custom conditions. Unlike the standards
            below, this round-trips with no loss, so you can move the whole record between browsers
            or keep an offline copy. Restoring replaces your current record.
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button type="button" className="btn btn--primary btn--sm" onClick={downloadBackup}>
              Download backup
            </button>
            <button
              type="button"
              className="btn btn--sm"
              aria-expanded={restoring}
              onClick={() => setRestoring((v) => !v)}
            >
              {restoring ? 'Cancel restore' : 'Restore from backup…'}
            </button>
          </div>
        </div>
        {restoring && (
          <div style={{ marginTop: 12 }}>
            <NativeRestore onRestore={handleRestore} onCancel={() => setRestoring(false)} />
          </div>
        )}
      </section>

      <h2 className="section-label">Standards export</h2>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 12,
          marginBottom: 24,
        }}
      >
        {EXPORTS.map((spec) => {
          // Describe each button by the export's name + description (and, for the
          // vantage-scoped .ics, the "whose calendar" note) so a screen-reader user tabbing
          // straight to a button — past five identical "Download"s — still knows which export
          // it is and, for the .ics, that it covers one person not the whole record (a11y
          // 2.4.6 / guardrail #5). `describedby` points at the visible copy, no duplication.
          const descId = `export-desc-${spec.id}`;
          const noteId = `export-note-${spec.id}`;
          const describedBy = spec.id === 'ics' ? `${descId} ${noteId}` : descId;
          return (
            <div className="card" key={spec.id}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{spec.name}</div>
              <div className="mono-dim" style={{ margin: '3px 0 9px' }}>
                {spec.standard}
              </div>
              <div
                id={descId}
                style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.5, minHeight: 54 }}
              >
                {spec.desc}
              </div>
              {spec.id === 'ics' && (
                <div id={noteId} className="mono-dim" style={{ margin: '6px 0 0' }}>
                  For {rootName} — change vantage on the Patterns view to export someone
                  else&rsquo;s.
                </div>
              )}
              <div className="row" style={{ marginTop: 10 }}>
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  aria-label={`Download ${spec.name}`}
                  aria-describedby={describedBy}
                  onClick={() => download(spec.filename, render(spec.id), spec.mime)}
                >
                  Download
                </button>
                <button
                  type="button"
                  className="btn btn--sm"
                  aria-label={`Preview ${spec.name}`}
                  aria-describedby={describedBy}
                  onClick={() => setPreview({ format: spec.id, text: render(spec.id) })}
                >
                  Preview
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {preview && (
        <section>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <h2 className="section-label" style={{ margin: 0 }}>
              Preview · {preview.format}
            </h2>
            <div className="row">
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => navigator.clipboard?.writeText(preview.text)}
              >
                Copy
              </button>
              <button type="button" className="btn btn--sm" onClick={() => setPreview(null)}>
                Close
              </button>
            </div>
          </div>
          {preview.format === 'svg' ? (
            <div className="card" dangerouslySetInnerHTML={{ __html: preview.text }} />
          ) : (
            <pre
              className="card"
              style={{
                overflow: 'auto',
                maxHeight: 420,
                fontFamily: 'var(--font-mono)',
                fontSize: 11.5,
                lineHeight: 1.5,
              }}
            >
              {preview.text}
            </pre>
          )}
        </section>
      )}
    </div>
  );
}
