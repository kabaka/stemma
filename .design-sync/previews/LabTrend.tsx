// LabTrend — a plain year/value/reference-range table for one lab test on one person,
// with a test picker. labSeries/labTitles read STRUCTURED `lab` payloads, which the
// illustrative seed doesn't carry (it stores only display strings), so we attach a few
// realistic measurements to the proband and seed the store the components read.
import { LabTrend, useStore, seedRecord } from 'stemma';

const record = seedRecord();
record.timeline = [
  ...record.timeline,
  // LDL falling across a statin-treatment window (user-entered reference upper bound).
  { id: 'pv-ldl-1', person: 'you', year: 2019, type: 'lab', title: 'LDL cholesterol', detail: '', lab: { value: 171, unit: 'mg/dL', refHigh: 100 } },
  { id: 'pv-ldl-2', person: 'you', year: 2021, type: 'lab', title: 'LDL cholesterol', detail: '', lab: { value: 168, unit: 'mg/dL', refHigh: 100 } },
  { id: 'pv-ldl-3', person: 'you', year: 2023, type: 'lab', title: 'LDL cholesterol', detail: '', lab: { value: 132, unit: 'mg/dL', refHigh: 100 } },
  { id: 'pv-ldl-4', person: 'you', year: 2025, type: 'lab', title: 'LDL cholesterol', detail: '', lab: { value: 98, unit: 'mg/dL', refHigh: 100 } },
  // TSH normalising on levothyroxine (user-entered reference band).
  { id: 'pv-tsh-1', person: 'you', year: 2016, type: 'lab', title: 'TSH', detail: '', lab: { value: 6.8, unit: 'mIU/L', refLow: 0.4, refHigh: 4.0 } },
  { id: 'pv-tsh-2', person: 'you', year: 2019, type: 'lab', title: 'TSH', detail: '', lab: { value: 3.1, unit: 'mIU/L', refLow: 0.4, refHigh: 4.0 } },
  { id: 'pv-tsh-3', person: 'you', year: 2024, type: 'lab', title: 'TSH', detail: '', lab: { value: 2.4, unit: 'mIU/L', refLow: 0.4, refHigh: 4.0 } },
];
useStore.setState({ record });

export const LipidTrend = () => <LabTrend personId="you" />;
