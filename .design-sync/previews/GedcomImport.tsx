// GedcomImport — file-import panel (file picker + Import/Cancel buttons).
// No store coupling. Renders its initial file-chooser state statically.
// One canonical cell: the idle/initial state before any file has been chosen.
import { GedcomImport } from 'stemma';

export const InitialFilePicker = () => (
  <GedcomImport onImport={() => {}} onCancel={() => {}} />
);
