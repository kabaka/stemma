// PersonDrawer — editing drawer for a selected person.
// Store-coupled: reads the Zustand singleton for person, people list, unions, and
// probandId. Renders inline (not a portal). Attaches a document keydown listener
// for Escape (close) — safe on static render since selectPerson is a no-op here.
// window.confirm fires ONLY on the Delete button click; not triggered on static render.
//
// Cell 1: Robert (father, id "robert") — Living, 3 conditions, part of a union.
//         Shows the identity-grid, organ inventory, ConditionPicker, and quick-add grid.
// Cell 2: Maya (proband, id "you") — proband, no Delete button, all sections.
import { PersonDrawer, useStore, seedRecord } from 'stemma';

const record = seedRecord();
useStore.setState({ record });

export const RobertDrawer = () => (
  <PersonDrawer personId="robert" onOpenForm={() => {}} />
);

export const MayaDrawer = () => (
  <PersonDrawer personId="you" onOpenForm={() => {}} />
);
