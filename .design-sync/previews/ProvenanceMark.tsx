// ProvenanceMark — a non-colour glyph + short label for a condition record's source.
// It's used inline, appended to a relative's condition in a findings / pattern line,
// so each cell shows one Provenance value in that real context. Axis = the Provenance.
import { ProvenanceMark } from 'stemma';

const line: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 13,
  color: 'var(--text-dim)',
};

export const RecordsConfirmed = () => (
  <span style={line}>
    Maternal Aunt — breast cancer, onset 47 <ProvenanceMark prov="record" />
  </span>
);
export const DeathCertificate = () => (
  <span style={line}>
    Paternal Grandfather — coronary disease, onset 70 <ProvenanceMark prov="death" />
  </span>
);
export const SelfReported = () => (
  <span style={line}>
    Brother — hypertension, onset 33 <ProvenanceMark prov="self" />
  </span>
);
