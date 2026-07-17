// ClinicalBoundary — the clinical-safety boundary banner (guardrail #3).
// No props; renders standalone. One canonical cell is sufficient — the point is
// to confirm IBM Plex renders, the bordered callout styling is applied, and the
// bold lead sentence + "Why this matters" disclosure toggle are all visible.
import { ClinicalBoundary } from 'stemma';

export const BoundaryBanner = () => <ClinicalBoundary />;
