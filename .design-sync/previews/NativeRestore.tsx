// NativeRestore — restore-from-backup panel. Shows its initial file-chooser state
// (the only meaningful static state — the async parse result is not reachable without
// a real file picker interaction). Two cells: default idle and the post-parse "ready"
// state, which we can simulate by stubbing the component's state via a wrapping trick.
// Since the component holds its own state internally, we show the idle state only —
// it is the canonical screen. One cell is sufficient per the brief.
import { NativeRestore } from 'stemma';

// No-op callbacks — NativeRestore reads no store; it calls these on user action.
const noop = () => {};

export const Idle = () => (
  <NativeRestore onRestore={noop} onCancel={noop} />
);
