// CurrentMedications — reads structured med payloads (event.med) from the store.
// The bare seed carries no med payloads, so we attach realistic medication events.
// Cell 1: proband with three ongoing medications (canonical filled state).
// Cell 2: proband's mother Susan with no ongoing meds (empty state / fallback card).
import { CurrentMedications, useStore, seedRecord } from 'stemma';

const record = seedRecord();
record.timeline = [
  ...record.timeline,
  {
    id: 'pv-med-1',
    person: 'you',
    year: 2016,
    type: 'medication',
    title: 'Levothyroxine',
    detail: '50 mcg daily',
    med: { dose: '50 mcg daily', ongoing: true },
  },
  {
    id: 'pv-med-2',
    person: 'you',
    year: 2021,
    type: 'medication',
    title: 'Atorvastatin',
    detail: '10 mg daily',
    med: { dose: '10 mg daily', ongoing: true },
  },
  {
    id: 'pv-med-3',
    person: 'you',
    year: 2023,
    type: 'medication',
    title: 'Sertraline',
    detail: '50 mg daily',
    med: { dose: '50 mg daily', ongoing: true },
  },
];
useStore.setState({ record });

export const OngoingMedications = () => <CurrentMedications personId="you" />;
export const EmptyMedications = () => <CurrentMedications personId="susan" />;
