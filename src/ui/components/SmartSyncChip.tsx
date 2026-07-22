import { useStore } from '@/store/useStore';
import { useSmartConnectionStore, type SmartConnection } from '@/store/useSmartConnectionStore';

/** The connection whose data is most overdue for a refresh — `lastSyncAt` if it has ever
 * synced, else `createdAt` (never synced counts as "most stale" of all). */
function mostStale(connections: SmartConnection[]): SmartConnection {
  return connections.reduce((oldest, c) =>
    (c.lastSyncAt ?? c.createdAt) < (oldest.lastSyncAt ?? oldest.createdAt) ? c : oldest,
  );
}

/**
 * Persistent, unobtrusive connection/sync status for the sidebar foot (DR-0016) — reuses the
 * same `.chip` idiom as the colorblind-palette toggle right above it. Renders nothing when
 * there are no SMART-on-FHIR connections, so it never takes over the app for someone who has
 * never connected a health record.
 *
 * A click navigates to the pedigree and asks the most-overdue connection to sync, via the
 * SAME `requestedSyncId` signal `App.tsx`'s OAuth-callback effect uses (see
 * `useSmartConnectionStore`) — no separate/duplicated sync-and-open-the-panel logic here.
 */
export function SmartSyncChip() {
  const connections = useSmartConnectionStore((s) => s.connections);
  if (connections.length === 0) return null;

  const stalest = mostStale(connections);
  const lastSyncLabel = stalest.lastSyncAt
    ? `synced ${new Date(stalest.lastSyncAt).toLocaleDateString()}`
    : 'not yet synced';
  const label =
    connections.length > 1
      ? `${connections.length} health records connected · ${lastSyncLabel}`
      : `Health record connected · ${lastSyncLabel}`;
  // The ACCESSIBLE name must say both what this chip shows and what activating it does — a
  // click doesn't just navigate, it also fires a re-sync (see `handleClick`), and that action
  // used to live only in `title` (invisible to keyboard users, inconsistently exposed across
  // screen readers). `aria-label` overrides the text-content-derived accessible name with one
  // that folds the action in; the visible chip text (`label`) is left as the compact sighted
  // display. `title` mirrors the same string as a supplemental tooltip only, never the sole
  // carrier of the action.
  const accessibleLabel = `${label} — sync now`;

  const handleClick = (): void => {
    useStore.getState().setView('tree');
    useSmartConnectionStore.getState().requestSync(stalest.id);
  };

  return (
    <button
      type="button"
      className="chip"
      onClick={handleClick}
      aria-label={accessibleLabel}
      title={accessibleLabel}
    >
      {label}
    </button>
  );
}
