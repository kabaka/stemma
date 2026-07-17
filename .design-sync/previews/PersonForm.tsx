// PersonForm — add/edit person modal.
// Portals to document.body, so it renders full-bleed relative to the iframe body.
// The focus-trap effect sets `.app` inert/aria-hidden on mount; ThemeSurface provides
// the `.app` element, so the modal will be visible while the ThemeSurface content
// behind it is hidden.
//
// Cell 1: Edit mode for Maya (proband, id "you") — pre-filled form with her existing
//         data. Uses { mode: 'edit', id: 'you' }.
// Cell 2: Add mode — adding a sibling for Maya. Uses { mode: 'add', anchor: 'you', relation: 'sibling' }.
import { PersonForm, useStore, seedRecord } from 'stemma';

const record = seedRecord();
useStore.setState({ record });

export const EditMaya = () => (
  <PersonForm state={{ mode: 'edit', id: 'you' }} onClose={() => {}} />
);

export const AddSibling = () => (
  <PersonForm state={{ mode: 'add', anchor: 'you', relation: 'sibling' }} onClose={() => {}} />
);
