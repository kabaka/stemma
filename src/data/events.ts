/** Timeline event-type display metadata. */
import type { EventType } from '@/domain/types';

export const EVENT_TYPES: readonly EventType[] = [
  'immunization',
  'visit',
  'lab',
  'diagnosis',
  'medication',
  'screening',
  'procedure',
  'genetic',
];

export const EVENT_META: Record<EventType, { label: string; color: string }> = {
  immunization: { label: 'Immunization', color: '#9be15d' },
  visit: { label: 'Visit', color: '#8b94a3' },
  lab: { label: 'Lab', color: '#6fa8ff' },
  diagnosis: { label: 'Diagnosis', color: '#ff5d5d' },
  medication: { label: 'Medication', color: '#34e2cf' },
  screening: { label: 'Screening', color: '#ff79c6' },
  procedure: { label: 'Procedure', color: '#b892ff' },
  genetic: { label: 'Genetic', color: '#ffd24a' },
};
