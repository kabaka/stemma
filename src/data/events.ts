/** Timeline event-type display metadata. */
import type { EventType } from '@/domain/types';

export const EVENT_TYPES: readonly EventType[] = [
  'immunization',
  'visit',
  'lab',
  'vital',
  'diagnosis',
  'medication',
  'allergy',
  'screening',
  'procedure',
  'genetic',
];

export const EVENT_META: Record<EventType, { label: string; color: string }> = {
  immunization: { label: 'Immunization', color: '#9be15d' },
  visit: { label: 'Visit', color: '#8b94a3' },
  lab: { label: 'Lab', color: '#6fa8ff' },
  vital: { label: 'Vital', color: '#6c7bff' },
  diagnosis: { label: 'Diagnosis', color: '#ff5d5d' },
  medication: { label: 'Medication', color: '#34e2cf' },
  allergy: { label: 'Allergy', color: '#ff9f45' },
  screening: { label: 'Screening', color: '#ff79c6' },
  procedure: { label: 'Procedure', color: '#b892ff' },
  genetic: { label: 'Genetic', color: '#ffd24a' },
};
