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

  const handleClick = (): void => {
    useStore.getState().setView('tree');
    useSmartConnectionStore.getState().requestSync(stalest.id);
  };

  return (
    <button
      type="button"
      className="chip"
      onClick={handleClick}
      title="Go to the pedigree and sync your connected health record"
    >
      {label}
    </button>
  );
}
