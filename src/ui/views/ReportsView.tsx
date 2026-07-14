import { useState } from 'react';
import { useStore } from '@/store/useStore';
import { useAsOfYear, useCatalog } from '../hooks';
import { buildFhirBundle, buildGedcom, buildPedigreeSvg, buildPhenopacket } from '@/export';

type Format = 'fhir' | 'phenopacket' | 'gedcom' | 'svg';

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
  const palette = useStore((s) => s.palette);
  const catalog = useCatalog();
  const asOfYear = useAsOfYear();
  const [preview, setPreview] = useState<{ format: Format; text: string } | null>(null);

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
    }
  };

  return (
    <div className="scroll">
      <div className="page-head">
        <h1 className="page-title">Reports &amp; Export</h1>
        <button type="button" className="btn btn--sm" onClick={() => window.print()}>
          Print summary
        </button>
      </div>
      <p className="lede">
        Your record is yours. Everything below is generated in your browser and exports to an open
        standard, so the data outlives the app. Nothing is uploaded.
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 12,
          marginBottom: 24,
        }}
      >
        {EXPORTS.map((spec) => (
          <div className="card" key={spec.id}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{spec.name}</div>
            <div className="mono-dim" style={{ margin: '3px 0 9px' }}>
              {spec.standard}
            </div>
            <div
              style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.5, minHeight: 54 }}
            >
              {spec.desc}
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={() => download(spec.filename, render(spec.id), spec.mime)}
              >
                Download
              </button>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => setPreview({ format: spec.id, text: render(spec.id) })}
              >
                Preview
              </button>
            </div>
          </div>
        ))}
      </div>

      {preview && (
        <section>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <div className="section-label" style={{ margin: 0 }}>
              Preview · {preview.format}
            </div>
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
