import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react';
import { useSmartConnectionStore, type SmartConnection } from '@/store/useSmartConnectionStore';
import {
  applyHealthRecordImport,
  parseFhirImport,
  stageHealthRecordImport,
  type HealthRecordSelections,
  type StagedHealthRecordImport,
} from '@/import';
import { useDisclosureFocus } from '../hooks';
import { buildTimeClientId } from '../config';
import { CcdaReview } from './CcdaReview';
import { ClinicalBoundary } from './ClinicalBoundary';
import type { Catalog } from '@/domain/catalog';
import type { Condition, FamilyRecord } from '@/domain/types';
import type { SmartProvider, SmartVendor } from '@/data/smart-endpoints';

/** Patient-facing vendor label, reused in the manual Client ID hint (FIX 6) below — a small
 * local duplicate of `ProviderPicker`'s own `VENDOR_LABEL`, not a shared import:
 * `ProviderPicker.tsx` (and the ~292 KB provider table its module scope loads at import time)
 * is intentionally lazy-loaded off this component's critical path (see the `lazy()` call
 * below); a static import from it here would pull that weight straight back in. */
const VENDOR_LABEL: Record<SmartVendor, string> = {
  epic: 'Epic',
  cerner: 'Oracle Health',
};

// Lazy-loaded so neither this component nor the ~292 KB bundled provider directory
// (`src/data/smart-endpoints.ts`) touch the app's critical-path bundle — only paid for
// once someone actually opens this panel (DR-0016). Verify with `npm run build` that it
// emits its own chunk.
const ProviderPicker = lazy(() =>
  import('./ProviderPicker').then((m) => ({ default: m.ProviderPicker })),
);

/** The active vendor drives which build-time client id (see `src/ui/config.ts`) applies. A
 * picked directory provider is authoritative (`selectedSource`); for a manually-typed FHIR
 * base URL there is no such tag, so it's inferred from the URL's actual hostname — never a
 * substring match against the raw URL string, which a crafted host (e.g.
 * `cerner.com.evil.example`, or `evil.example/path/cerner.com`) could spoof to misattach the
 * Cerner client id to an attacker-controlled origin and suppress the manual-entry prompt.
 * Defaults to `epic` on a host that isn't `cerner.com` or a subdomain of it — Epic is
 * Stemma's original, still-most-common path, so an unrecognized (or not-yet-parseable, e.g.
 * the user is still typing) host degrading to it is the least surprising fallback. */
export function inferVendor(selectedSource: SmartVendor | null, fhirBaseUrl: string): SmartVendor {
  if (selectedSource) return selectedSource;
  try {
    const host = new URL(fhirBaseUrl).hostname.toLowerCase();
    if (host === 'cerner.com' || host.endsWith('.cerner.com')) return 'cerner';
  } catch {
    // Not a parseable URL yet (e.g. the user is mid-typing) — fall through to the epic default.
  }
  return 'epic';
}

interface SmartFhirConnectProps {
  /** A snapshot of the live record + catalog to reconcile against, taken from the parent —
   * matches {@link CcdaImport}'s props-in shape so this panel never reads the record store
   * itself (only the separate `useSmartConnectionStore`, which owns the OAuth/token flow). */
  record: FamilyRecord;
  catalog: Catalog;
  /** Called with the merged record + any newly-registered long-tail extensions once the user
   * confirms in the review step. The parent owns the store write (`replaceRecord`) and its own
   * "this changes your record" confirmation, matching {@link CcdaImport} — a MERGE, not a
   * replace: nothing already in the record is removed. */
  onImport: (record: FamilyRecord, extensions: Condition[]) => void;
  onCancel: () => void;
}

/** The exact redirect URI a provider registration must match — the app's own origin plus its
 * deployed base path (so a GitHub Pages subpath deployment still registers correctly), computed
 * fresh on every render rather than cached, since it depends only on where the page is served
 * from. Passed explicitly to `beginConnect`. No longer surfaced as its own UI field (DR-0016):
 * Epic fixes redirect URIs at app-registration time (an out-of-band, one-time step for whoever
 * registers Stemma with a provider, not a per-user runtime concern), so displaying it to every
 * end user was misleading rather than merely informational. */
function redirectUri(): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}`;
}

/** Turn a thrown `Error` from the connect/sync flow into guidance a non-technical user can act
 * on. Stemma runs entirely client-side with no server of its own to proxy around a provider
 * that hasn't allowlisted this origin, so a bare network failure (the browser hides the real
 * CORS reason from JS) gets the most explanation; the rest map the gateway's own descriptive
 * `Error` messages (see `integrations/smart-fhir/gateway.ts` and `discovery.ts`) to friendlier
 * copy without inventing detail the error didn't carry. */
function friendlyError(err: unknown, context: 'connect' | 'sync'): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/failed to fetch|networkerror|load failed|invalid url/i.test(message)) {
    return "Couldn't reach that server from your browser. Either the FHIR base URL is wrong, or this provider hasn't enabled browser-based (CORS) access for SMART apps yet — Stemma runs entirely in your browser and has no server to route around that. Double-check the URL, or ask the provider/IT admin whether CORS is enabled.";
  }
  if (
    /SMART discovery failed|is missing an authorization_endpoint|is missing a token_endpoint|no SMART oauth-uris/i.test(
      message,
    )
  ) {
    return "Couldn't read a SMART configuration at that URL. Make sure you're using the provider's FHIR base URL — the one that ends in the version path such as /api/FHIR/R4/ — and not their login or OAuth URL. (Discovery is served at <base>/.well-known/smart-configuration, so a parent URL won't resolve.)";
  }
  if (/state mismatch/i.test(message)) {
    return 'The sign-in could not be verified for safety and was cancelled. Try connecting again.';
  }
  if (/Token request failed/i.test(message)) {
    return `Sign-in with this provider failed (${message}). Try connecting again, or ask your provider/IT admin to confirm Stemma's redirect URI is registered correctly.`;
  }
  if (/FHIR read failed/i.test(message)) {
    return `The server rejected the data request (${message}). Your access may have expired — use "Sign in again" below to reconnect.`;
  }
  if (/reauthorized/i.test(message)) {
    return `${message} Use "Sign in again" below to reconnect.`;
  }
  return context === 'connect' ? `Couldn't connect: ${message}` : `Sync failed: ${message}`;
}

/**
 * Moves focus to whatever element `ref` is currently attached to, whenever `dep` changes
 * to a new value — but never on the initial mount. `useDisclosureFocus` (see `hooks.ts`)
 * is a one-shot mount effect shared by every other disclosure in the app; it can't help
 * here because this component never unmounts across its own internal step transitions
 * (connect form → sync-review; the collapsed "+ Connect another provider" row → its own
 * form). Each of those swaps the DOM node the previously-focused control lived on without
 * unmounting the *component*, so the mount-only effect never re-fires and focus silently
 * falls to `<body>` (WCAG 2.4.3). Callers attach the SAME ref to whichever element should
 * receive focus for the CURRENT render (e.g. a heading in one branch, a trigger button in
 * another) — the ref always points at the right live node by the time this effect runs.
 */
function useFocusOnChange<T extends HTMLElement>(dep: unknown): RefObject<T | null> {
  const ref = useRef<T>(null);
  const prev = useRef(dep);
  useEffect(() => {
    if (prev.current !== dep) ref.current?.focus();
    prev.current = dep;
  }, [dep]);
  return ref;
}

/** One label/value tile — a local copy of `PersonDrawer`'s private `IdentityTile`, matching
 * how `CcdaImport`/`GedcomImport` each keep their own small local copy of `readFileText` rather
 * than sharing a one-off across unrelated components. */
function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="identity-tile">
      <div className="identity-tile__label">{label}</div>
      <div className="identity-tile__value">{value}</div>
    </div>
  );
}

/** True when a sync error indicates the connection's access has expired and re-auth (not a
 * retried sync) is what will actually fix it — drives which of "Sync now" / "Sign in again" is
 * the card's primary action. Tested against the FRIENDLY (already-mapped) error text, since
 * that's what callers hold; see `friendlyError`'s own `reauthorized`/`FHIR read failed`
 * branches, both of which route the user to "Sign in again" in their copy. */
function isExpiryError(syncError: string | null): boolean {
  return (
    syncError != null && /reauthoriz|expired|access may have expired|sign in again/i.test(syncError)
  );
}

/** One connected provider: status, scopes, sync/reconnect/disconnect controls, and its own sync
 * error (each connection syncs independently, so one failing must never block or hide the
 * others). */
function ConnectionCard({
  connection,
  syncing,
  syncError,
  onSync,
  onReconnect,
  onDisconnect,
  onSetStayConnected,
}: {
  connection: SmartConnection;
  syncing: boolean;
  syncError: string | null;
  onSync: (id: string) => void;
  onReconnect: (connection: SmartConnection) => void;
  onDisconnect: (id: string) => void;
  onSetStayConnected: (id: string, stayConnected: boolean) => void;
}) {
  const stayId = useId();
  // When the current error means "you need to sign in again" (no refresh token / expired
  // session — the normal case for Cerner's ~10-min access tokens and for Epic without "Stay
  // connected"), retrying "Sync now" can't help until re-auth happens, so "Sign in again"
  // becomes the primary action and "Sync now" steps back to secondary.
  const expired = isExpiryError(syncError);
  return (
    <div className="card" style={{ padding: '10px 12px', display: 'grid', gap: 10 }}>
      <div className="identity-grid">
        <Tile label="Provider" value={connection.fhirBaseUrl} />
        <Tile label="Patient" value={connection.patientId ?? 'Not yet available'} />
        <Tile
          label="Last synced"
          value={connection.lastSyncAt ? new Date(connection.lastSyncAt).toLocaleString() : 'Never'}
        />
        <Tile
          label="Unattended sync"
          value={connection.offlineAccessGranted ? 'Available' : 'Not granted'}
        />
      </div>

      <div>
        <span className="lbl">Scopes granted</span>
        <p className="mono-dim" style={{ margin: '2px 0 0' }}>
          {connection.scopesGranted.length > 0 ? connection.scopesGranted.join(', ') : 'None'}
        </p>
      </div>

      {!connection.offlineAccessGranted && (
        <p className="mono-dim" style={{ margin: 0 }}>
          This provider didn&rsquo;t grant unattended background access, so syncing again may ask
          you to sign in with them first.
        </p>
      )}

      {syncError && (
        <div className="disclaimer" role="alert">
          {syncError}
        </div>
      )}

      <div className="row wrap" style={{ gap: 12 }}>
        <button
          type="button"
          className={expired ? 'btn btn--sm' : 'btn btn--primary btn--sm'}
          onClick={() => onSync(connection.id)}
          aria-disabled={syncing}
          // The visible label switches to "Syncing…" while in flight — the accessible name must
          // switch with it (WCAG 2.5.3 Label in Name requires the visible text stay CONTAINED in
          // the accessible name; a static "Sync now for <url>" would stop containing "Syncing…").
          aria-label={
            syncing
              ? `Syncing for ${connection.fhirBaseUrl}`
              : `Sync now for ${connection.fhirBaseUrl}`
          }
        >
          {syncing ? 'Syncing…' : 'Sync now'}
        </button>
        <button
          type="button"
          className={expired ? 'btn btn--primary btn--sm' : 'btn btn--sm'}
          onClick={() => onReconnect(connection)}
          aria-label={`Sign in again to ${connection.fhirBaseUrl}`}
        >
          Sign in again
        </button>
        <label className="row" style={{ gap: 6, fontSize: 12 }} htmlFor={stayId}>
          <input
            id={stayId}
            type="checkbox"
            checked={connection.stayConnected}
            onChange={(e) => onSetStayConnected(connection.id, e.target.checked)}
          />
          Stay connected on this device
        </label>
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => onDisconnect(connection.id)}
          aria-label={`Disconnect ${connection.fhirBaseUrl}`}
        >
          Disconnect
        </button>
      </div>
    </div>
  );
}

/**
 * Connect/status panel for the client-side SMART-on-FHIR importer (DR-0020): registers a
 * standalone PKCE OAuth connection to a patient's own choice of FHIR server, syncs their
 * Condition + FamilyMemberHistory data, and hands the result to the same staged review
 * ({@link CcdaReview}, reused rather than forked) every other health-record import uses before
 * anything merges into the pedigree. Mirrors {@link CcdaImport}'s shape (props-in record/
 * catalog, `onImport`/`onCancel` callbacks) so `PedigreeView` wires it identically.
 *
 * Never touches a raw token — all OAuth/network flow goes through `useSmartConnectionStore`;
 * this component only reads its connection metadata and calls its actions.
 */
export function SmartFhirConnect({ record, catalog, onImport, onCancel }: SmartFhirConnectProps) {
  const connections = useSmartConnectionStore((s) => s.connections);
  const beginConnect = useSmartConnectionStore((s) => s.beginConnect);
  const syncNow = useSmartConnectionStore((s) => s.syncNow);
  const disconnect = useSmartConnectionStore((s) => s.disconnect);
  const setStayConnected = useSmartConnectionStore((s) => s.setStayConnected);
  // Set by `completeCallbackIfPresent` (see App.tsx) when the OAuth redirect back from the
  // provider failed — the redirect is a full page reload, so this persisted-in-store error
  // is the only way that failure can ever reach the user; there's no in-memory state left
  // to carry it. `PedigreeView` reads the same field to auto-open this panel on mount.
  const callbackError = useSmartConnectionStore((s) => s.callbackError);
  const clearCallbackError = useSmartConnectionStore((s) => s.clearCallbackError);
  // Set on a successful OAuth callback (the new connection's id) or by `SmartSyncChip`'s
  // manual re-sync — see the store field's own doc. Consumed below to auto-fire the
  // existing `handleSync` exactly once (DR-0016).
  const requestedSyncId = useSmartConnectionStore((s) => s.requestedSyncId);
  const clearRequestedSync = useSmartConnectionStore((s) => s.clearRequestedSync);

  const [fhirBaseUrl, setFhirBaseUrl] = useState('');
  // Set by the picker's `onSelect` alongside `fhirBaseUrl`; cleared the moment the user edits
  // the manual FHIR base URL field instead (that's no longer a directory pick). `null` means
  // "infer from the URL" — see `inferVendor` above and `activeVendor` below.
  const [selectedSource, setSelectedSource] = useState<SmartVendor | null>(null);
  const [manualClientId, setManualClientId] = useState('');
  const [stayConnectedOptIn, setStayConnectedOptIn] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [addingAnother, setAddingAnother] = useState(false);

  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [syncErrors, setSyncErrors] = useState<Record<string, string>>({});
  const [staged, setStaged] = useState<StagedHealthRecordImport | null>(null);
  // Persistent polite live-region text (mirrors `CcdaImport`'s own `role="status"` idiom) —
  // set once on a successful sync and never unmounted afterward (see the render below),
  // so a screen reader announces the mutation rather than missing an already-populated
  // region on mount.
  const [syncStatus, setSyncStatus] = useState('');

  const mainHeadingRef = useDisclosureFocus<HTMLHeadingElement>();
  // Recurring (not mount-only) focus-transition refs — see `useFocusOnChange` above. Each
  // is attached to whichever element should take focus for the CURRENT render: the review
  // step's own heading once `staged` is set, and either the "Connect another provider"
  // heading (form open) or the trigger button that opened it (form closed) as `addingAnother`
  // flips.
  const reviewHeadingRef = useFocusOnChange<HTMLHeadingElement>(staged != null);
  const addAnotherFocusRef = useFocusOnChange<HTMLElement>(addingAnother);
  const baseUrlId = useId();
  const baseUrlHintId = useId();
  const clientIdId = useId();
  const clientIdHintId = useId();
  const connectErrorId = useId();

  const showConnectForm = connections.length === 0 || addingAnother;
  const uri = redirectUri();
  // Which vendor's build-time client id (see `src/ui/config.ts`) applies — a picked directory
  // provider is authoritative; a manually-typed URL is inferred from its host. Recomputed
  // whenever the picked provider or the manual URL changes, never a module-level constant,
  // since which vendor is "active" now varies per connection attempt.
  const activeVendor = useMemo(
    () => inferVendor(selectedSource, fhirBaseUrl),
    [selectedSource, fhirBaseUrl],
  );
  const resolvedClientId = useMemo(() => buildTimeClientId(activeVendor), [activeVendor]);
  // The active vendor's build-time id (from a GitHub Actions Variable, DR-0016) always wins
  // when present; the manual field only exists (see the render below) for a vendor whose
  // Variable isn't set on this build (a fork, or a deploy that's only configured one vendor).
  const effectiveClientId = resolvedClientId ?? manualClientId;

  const closeConnectForm = (): void => {
    if (connections.length > 0) {
      setAddingAnother(false);
      setConnectError(null);
    } else {
      onCancel();
    }
  };

  const handleConnect = async (): Promise<void> => {
    // Guard against a fast double-click/double-Enter firing this twice while the first
    // call is still in flight — `aria-disabled` (below) doesn't stop a second event the
    // way a real `disabled` attribute would (mirrors `CcdaReview.handleConfirmClick`).
    if (connecting) return;
    setConnectError(null);
    const trimmedBase = fhirBaseUrl.trim();
    const trimmedClient = effectiveClientId.trim();
    if (!trimmedBase || !trimmedClient) {
      setConnectError(
        resolvedClientId
          ? 'Pick your provider above, or enter its FHIR base URL manually.'
          : 'Enter both the FHIR base URL and the client ID your provider issued.',
      );
      return;
    }
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(trimmedBase);
    } catch {
      setConnectError('That doesn’t look like a valid URL — it should start with https://.');
      return;
    }
    // Stemma has no server to proxy around a plain-http endpoint, and the CSP failing the
    // fetch silently would surface as an opaque "Couldn't reach that server" network error
    // rather than telling the user what's actually wrong — check the scheme explicitly.
    if (parsedUrl.protocol !== 'https:') {
      setConnectError(
        'That URL must start with https:// — Stemma only connects to a FHIR server over an encrypted connection.',
      );
      return;
    }
    setConnecting(true);
    try {
      await beginConnect(trimmedBase, trimmedClient, {
        stayConnected: stayConnectedOptIn,
        redirectUri: uri,
      });
      // On success this navigates away to the provider's sign-in page; nothing left to do here.
    } catch (err) {
      setConnecting(false);
      setConnectError(friendlyError(err, 'connect'));
    }
  };

  /** One-click re-auth for an already-connected provider (DR-0033): replay OAuth against the
   * SAME endpoint/client id/stay-connected choice the connection was made with — no re-picking
   * needed — so `completeCallbackIfPresent`'s reconnect-in-place logic (see the store) updates
   * this exact card rather than spawning a new one. `beginConnect` navigates away on success, so
   * there's nothing to do after that; the only failure mode here is discovery/navigation itself
   * throwing before the redirect happens (e.g. the server is unreachable), which is surfaced on
   * this connection's own error slot exactly like a failed sync would be — no re-entrancy guard
   * beyond that: a duplicate click just re-navigates. */
  const handleReconnect = async (connection: SmartConnection): Promise<void> => {
    try {
      await beginConnect(connection.fhirBaseUrl, connection.clientId, {
        stayConnected: connection.stayConnected,
        redirectUri: uri,
      });
    } catch (err) {
      setSyncErrors((prev) => ({ ...prev, [connection.id]: friendlyError(err, 'connect') }));
    }
  };

  const handleSync = async (connectionId: string): Promise<void> => {
    // Same re-entrancy guard as handleConnect — `aria-disabled` on the Sync button doesn't
    // block a second click while the first sync is still running.
    if (syncingId) return;
    setSyncErrors((prev) => {
      if (!(connectionId in prev)) return prev;
      const rest = { ...prev };
      delete rest[connectionId];
      return rest;
    });
    setSyncingId(connectionId);
    try {
      // The store hands back the RAW FhirImportBundle only (it never imports the `src/import`
      // layer — see useSmartConnectionStore's own layering note); parsing it into a
      // ParsedHealthRecord is UI-layer work, matching how CcdaImport.tsx parses its file
      // before staging. `connection?.patientId` seeds parseFhirImport the same patient
      // context the gateway itself scoped the read to (falls back to bundle-inferred
      // matching when a connection somehow isn't found).
      const connection = connections.find((c) => c.id === connectionId);
      const bundle = await syncNow(connectionId);
      const parsed = parseFhirImport(bundle, { patientId: connection?.patientId ?? undefined });
      if (
        parsed.proband.problems.length === 0 &&
        parsed.familyMembers.length === 0 &&
        parsed.proband.events.length === 0
      ) {
        setSyncErrors((prev) => ({
          ...prev,
          [connectionId]:
            'No conditions, family history, or health events were found for this patient.',
        }));
        return;
      }
      setSyncStatus(
        `Synced ${parsed.proband.problems.length} ${
          parsed.proband.problems.length === 1 ? 'condition' : 'conditions'
        }, ${parsed.familyMembers.length} ${
          parsed.familyMembers.length === 1 ? 'family member' : 'family members'
        }, and ${parsed.proband.events.length} health ${
          parsed.proband.events.length === 1 ? 'event' : 'events'
        } — review below.`,
      );
      setStaged(stageHealthRecordImport(parsed, record, catalog));
    } catch (err) {
      setSyncErrors((prev) => ({ ...prev, [connectionId]: friendlyError(err, 'sync') }));
    } finally {
      setSyncingId(null);
    }
  };

  // Auto-fire `handleSync` once for a connection a callback success (or `SmartSyncChip`)
  // just asked for — the success-path counterpart to `callbackError` above.
  //
  // `handleSync`/`clearRequestedSync`/`connections` are all recreated every render (not
  // memoized), so the triggering effect below reads them through this ref instead of
  // closing over them directly — that keeps its own dependency array honestly exhaustive
  // (just `requestedSyncId`, the one value that should actually refire it) rather than
  // needing a lint-suppressed dependency list that would refire on every unrelated render.
  // This second effect has no dependency array by design — it's meant to run after every
  // render, purely to keep the ref current, mirroring React's own documented pattern for
  // reading "the latest" value of something inside an effect without depending on it.
  const latestRef = useRef({ connections, handleSync, clearRequestedSync });
  useEffect(() => {
    latestRef.current = { connections, handleSync, clearRequestedSync };
  });

  // `autoSyncedRef` is a per-SIGNAL-EPISODE latch, mirroring `App.tsx`'s own
  // `smartCallbackFired` ref: it stops React 18 StrictMode's dev double-invoke from firing
  // `handleSync` twice for the SAME episode (the effect body runs twice against the same
  // closed-over `requestedSyncId` before any state update from the first run can flow back
  // in). It must NOT latch forever, though — connection ids are stable UUIDs, so a later,
  // genuinely distinct `requestSync(sameId)` (e.g. `SmartSyncChip`'s re-sync, which targets
  // the most-stale connection and is often the only one) would otherwise match the same
  // `=== requestedSyncId` check and silently no-op. So the latch is reset back to `null` the
  // moment `requestedSyncId` returns to `null` (below) — the store's own one-shot-signal
  // discipline — meaning each new episode starts with a clear latch and gets honored.
  // `clearRequestedSync()` still runs synchronously as this effect's first statement for a
  // NEW episode — before `handleSync`'s first `await` — so the signal never lingers to be
  // picked up again later; this now runs unconditionally (including when the referenced
  // connection isn't found), so a stale/bogus id can never strand `requestedSyncId` non-null.
  // `handleSync` itself still guards re-entrancy via `syncingId` as a second, independent
  // layer.
  const autoSyncedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!requestedSyncId) {
      autoSyncedRef.current = null;
      return;
    }
    if (autoSyncedRef.current === requestedSyncId) return;
    autoSyncedRef.current = requestedSyncId;
    const {
      connections: latestConnections,
      handleSync: sync,
      clearRequestedSync: clear,
    } = latestRef.current;
    clear();
    if (!latestConnections.some((c) => c.id === requestedSyncId)) return;
    void sync(requestedSyncId);
  }, [requestedSyncId]);

  const handleConfirm = (selections: HealthRecordSelections): void => {
    if (!staged) return;
    const { record: merged, extensions } = applyHealthRecordImport(
      record,
      staged,
      selections,
      catalog,
    );
    onImport(merged, extensions);
  };

  if (staged) {
    return (
      <div className="card" style={{ marginBottom: 16, display: 'grid', gap: 14 }}>
        <h2 className="overline" tabIndex={-1} ref={reviewHeadingRef} style={{ margin: 0 }}>
          Review synced health record
        </h2>
        {/* Same DOM node (same type + position in the returned tree) as the live region in
            the connect-form branch below, so React preserves it across the `staged`
            transition instead of unmount/remount — a screen reader announces the text
            mutation rather than potentially missing a freshly-inserted region. */}
        <p role="status" className="mono-dim" style={{ margin: 0, minHeight: 18 }}>
          {syncStatus}
        </p>
        <CcdaReview
          staged={staged}
          record={record}
          onConfirm={handleConfirm}
          onCancel={onCancel}
          headingLevel="h3"
        />
      </div>
    );
  }

  return (
    <div className="card" style={{ marginBottom: 16, display: 'grid', gap: 14 }}>
      <h2 className="overline" tabIndex={-1} ref={mainHeadingRef} style={{ margin: 0 }}>
        Connect a health record (SMART on FHIR)
      </h2>
      <p role="status" className="mono-dim" style={{ margin: 0, minHeight: 18 }}>
        {syncStatus}
      </p>
      <p className="mono-dim" style={{ margin: 0, lineHeight: 1.5 }}>
        Connect directly to your patient portal&rsquo;s FHIR server (Epic MyChart, Cerner/Oracle
        Health, and most US portals support this) using the SMART-on-FHIR standard. You sign in with
        your provider, not Stemma, and choose exactly what to bring in before anything is added.
      </p>

      <ClinicalBoundary />

      {callbackError && (
        <div className="disclaimer" role="alert">
          <p style={{ margin: 0 }}>{friendlyError(callbackError, 'connect')}</p>
          <button
            type="button"
            className="btn btn--sm"
            style={{ marginTop: 8 }}
            onClick={clearCallbackError}
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="disclaimer">
        <b>What this shares:</b> once connected, syncing reads your data directly from the FHIR
        server you register below — never through a Stemma server, and never to any third party or
        analytics. <b>What&rsquo;s stored on this device:</b> the connection details (provider
        address, granted scopes) always; the short-lived access token only for this browser session;
        a refresh token only if you check &ldquo;Stay connected&rdquo;, so Stemma can sync again
        without asking you to sign in every time.
      </div>

      {connections.length > 0 && (
        <ul className="plain-list" role="list" style={{ display: 'grid', gap: 10 }}>
          {connections.map((c) => (
            <li key={c.id}>
              <ConnectionCard
                connection={c}
                syncing={syncingId === c.id}
                syncError={syncErrors[c.id] ?? null}
                onSync={(id) => void handleSync(id)}
                onReconnect={(conn) => void handleReconnect(conn)}
                onDisconnect={disconnect}
                onSetStayConnected={setStayConnected}
              />
            </li>
          ))}
        </ul>
      )}

      {showConnectForm ? (
        <div style={{ display: 'grid', gap: 12 }}>
          {/* Only shown when opening the form via "+ Connect another provider" — the
              zero-connections case already gets the panel's own top heading on mount
              (mainHeadingRef), so this would be a redundant, misleadingly-worded ("another")
              heading there. Receives focus via addAnotherFocusRef when `addingAnother`
              flips true (see useFocusOnChange above) — the control that opened this form
              (the trigger button below) unmounts, so focus must be moved explicitly. */}
          {addingAnother && (
            <h3
              className="overline"
              tabIndex={-1}
              ref={addAnotherFocusRef as RefObject<HTMLHeadingElement>}
              style={{ margin: 0 }}
            >
              Connect another provider
            </h3>
          )}
          {/* Primary path (DR-0016): search the bundled, multi-vendor (Epic + Cerner/Oracle
              Health) provider directory instead of hand-typing a FHIR endpoint. Lazy-loaded
              (see the top-of-file `lazy()` call) so the ~292 KB provider table only loads once
              this panel is actually open. A pick is authoritative for which vendor is active
              (`selectedSource`), overriding whatever the manual URL below might otherwise
              infer. */}
          <Suspense fallback={<p className="mono-dim">Loading the provider directory…</p>}>
            <ProviderPicker
              onSelect={(provider: SmartProvider) => {
                setFhirBaseUrl(provider.fhirBaseUrl);
                setSelectedSource(provider.source);
                setConnectError(null);
              }}
            />
          </Suspense>

          {/* Only rendered when the ACTIVE vendor (see `activeVendor` above) has no build-time
              client id on this build — each vendor issues one client id across every org/tenant
              it hosts, so a deployed build with that vendor's Variable set ships it once and
              skips asking; a build with only one vendor's Variable set still asks the moment
              the user picks (or types a URL inferred as) the other vendor.

              This wrapping `role="status"` div is ALWAYS in the DOM (unlike the field it
              holds) so a screen reader picks up the insertion as a live-region content change
              (WCAG 4.1.3) rather than possibly missing an already-populated region that
              appeared out of nowhere — focus stays in the picker/URL field the user was just
              in, so this is the only way the new required field gets announced. */}
          <div role="status">
            {!resolvedClientId && (
              <div>
                <label className="lbl" htmlFor={clientIdId}>
                  Client ID
                </label>
                <input
                  id={clientIdId}
                  className="field"
                  type="text"
                  autoComplete="off"
                  aria-describedby={
                    connectError ? `${clientIdHintId} ${connectErrorId}` : clientIdHintId
                  }
                  aria-invalid={Boolean(connectError)}
                  value={manualClientId}
                  onChange={(e) => setManualClientId(e.target.value)}
                />
                <p id={clientIdHintId} className="mono-dim" style={{ marginTop: 6 }}>
                  This provider needs a Client ID you register yourself — issued when you register
                  Stemma with {VENDOR_LABEL[activeVendor]}. Stemma has no client ID of its own since
                  every install is a separate registration you control.
                </p>
              </div>
            )}
          </div>

          {/* Fallback for a provider not in the picker above (a brand the directory snapshot
              doesn't carry) — collapsed by default so it doesn't compete with the picker as
              the form's primary affordance. */}
          <details className="disclosure">
            <summary className="disclosure__toggle">
              Can&rsquo;t find your provider? Enter a FHIR endpoint URL manually
            </summary>
            <div className="disclosure__body">
              <label className="lbl" htmlFor={baseUrlId}>
                FHIR base URL
              </label>
              <input
                id={baseUrlId}
                className="field"
                type="url"
                inputMode="url"
                autoComplete="off"
                placeholder="https://fhir.myprovider.example/api/FHIR/R4"
                aria-describedby={
                  connectError ? `${baseUrlHintId} ${connectErrorId}` : baseUrlHintId
                }
                aria-invalid={Boolean(connectError)}
                value={fhirBaseUrl}
                onChange={(e) => {
                  setFhirBaseUrl(e.target.value);
                  // Editing this field by hand means it's no longer a directory pick — fall
                  // back to inferring the vendor from whatever host the user types (see
                  // `inferVendor` above).
                  setSelectedSource(null);
                }}
              />
              <p id={baseUrlHintId} className="mono-dim" style={{ marginTop: 6 }}>
                Your provider&rsquo;s FHIR <strong>base</strong> URL — the one ending in the version
                path (e.g. <code>&hellip;/api/FHIR/R4/</code>), not their login or OAuth URL. Find
                it on their developer portal (e.g. Epic on FHIR, Cerner Code) or from when you
                registered Stemma as an app.
              </p>
            </div>
          </details>

          <label className="row" style={{ gap: 8 }}>
            <input
              type="checkbox"
              checked={stayConnectedOptIn}
              onChange={(e) => setStayConnectedOptIn(e.target.checked)}
            />
            Stay connected on this device (keeps a refresh token so future syncs don&rsquo;t require
            signing in again, if your provider grants it)
          </label>

          {connectError && (
            <div id={connectErrorId} className="disclaimer" role="alert">
              {connectError}
            </div>
          )}

          <div className="row">
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={() => void handleConnect()}
              aria-disabled={connecting}
            >
              {connecting ? 'Connecting…' : 'Connect'}
            </button>
            <button type="button" className="btn btn--sm" onClick={closeConnectForm}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="row">
          <button
            type="button"
            className="btn btn--sm"
            ref={addAnotherFocusRef as RefObject<HTMLButtonElement>}
            onClick={() => setAddingAnother(true)}
          >
            + Connect another provider
          </button>
          <button type="button" className="btn btn--sm" onClick={onCancel}>
            Close
          </button>
        </div>
      )}
    </div>
  );
}
