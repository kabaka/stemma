// Barrel entry for the design-sync bundle. Stemma is an application, not a
// published component library, so there is no dist entry to point the converter
// at — this file is the explicit public surface of the design system: the 12
// reusable UI components under src/ui/components/, re-exported by their real
// names. Passed to package-build.mjs via --entry; PKG_DIR walks up from
// .design-sync/ to the repo root (package.json name "stemma").
//
// The store + seed helpers are re-exported from the SAME bundle so authored
// preview modules (.design-sync/previews/*.tsx) can seed the real Zustand
// singleton the components read — importing the store from '@/…' separately
// would create a second singleton the bundled components never see.

import type { ReactNode } from 'react';

// Preview surface wrapper (cfg.provider). Stemma is a DARK app: its components
// live inside a dark `body`/`.app` and many leaf components paint no background
// of their own, so on a light preview canvas their near-white text is invisible.
// Wrapping every preview card in the app's dark surface is how the components are
// actually used. Not a design-system component (excluded via componentSrcMap).
export function ThemeSurface({ children }: { children?: ReactNode }) {
  return (
    <div
      className="app"
      style={{
        background: 'var(--bg)',
        color: 'var(--text)',
        fontFamily: 'var(--font-sans)',
        padding: 20,
        minHeight: '100%',
      }}
    >
      {children}
    </div>
  );
}

export { ClinicalBoundary } from '@/ui/components/ClinicalBoundary';
export { ConditionPicker } from '@/ui/components/ConditionPicker';
export { CurrentMedications } from '@/ui/components/CurrentMedications';
export { FlagCard } from '@/ui/components/FlagCard';
export { GedcomImport } from '@/ui/components/GedcomImport';
export { LabTrend } from '@/ui/components/LabTrend';
export { NativeRestore } from '@/ui/components/NativeRestore';
export { HighlightBar } from '@/ui/components/PedigreeHighlight';
export { PersonDrawer } from '@/ui/components/PersonDrawer';
export { PersonForm } from '@/ui/components/PersonForm';
export { PrintReports } from '@/ui/components/PrintReports';
export { ProvenanceMark } from '@/ui/components/ProvenanceMark';

// Preview-only helpers (not design-system components — camelCase, so filtered
// from the component list, but exported so authored previews can compose real
// domain data from the SAME bundle the components read).
export { useStore } from '@/store/useStore';
export { seedRecord, emptyRecord } from '@/data/seed';
export { buildCatalog } from '@/domain/catalog';
export { detectPatterns, familyFindings } from '@/domain/patterns';
