// PrintReports — three-sheet print layout (pedigree, red-flag summary, personal-health).
// The component root carries className="print-reports" which is `display:none` in the
// bundled stylesheet (the element only appears under @media print). We inject a <style>
// tag into the preview to force it visible in the screenshot context so the design-sync
// capture can record the layout. The print-* CSS classes are defined only inside
// @media print so the visual presentation is structural-only (text, tables, headings)
// rather than the black-on-white paper styling — that is expected for this component.
//
// Seeding: PrintReports reads record + palette from the Zustand store via hooks.
import { PrintReports, useStore, seedRecord } from 'stemma';

useStore.setState({ record: seedRecord() });

export const AllSheets = () => (
  <>
    <style>{`.print-reports { display: block !important; }`}</style>
    <PrintReports />
  </>
);
