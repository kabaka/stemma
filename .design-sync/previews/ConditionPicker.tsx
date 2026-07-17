// ConditionPicker — add/remove/annotate a person's conditions.
// Store-coupled: reads the Zustand singleton for the person's condition list and the
// catalog. At rest (no query typed) it shows the person's existing conditions with
// onset/provenance controls, plus the empty search input. No network call fires until
// the user types 2+ chars and clicks "Search all ICD-10-CM…".
//
// Cell 1: Maya (proband, id "you") — 3 conditions (thyroid, cholesterol, depression).
// Cell 2: Robert (father, id "robert") — 3 conditions (CAD, hypertension, cholesterol).
import { ConditionPicker, useStore, seedRecord } from 'stemma';

const record = seedRecord();
useStore.setState({ record });

export const MayaConditions = () => <ConditionPicker personId="you" />;
export const RobertConditions = () => <ConditionPicker personId="robert" />;
