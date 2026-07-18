import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { useSmartConnectionStore, type SmartConnection } from '@/store/useSmartConnectionStore';
import {
  applyHealthRecordImport,
  parseFhirImport,
  stageHealthRecordImport,
  type HealthRecordSelections,
  type StagedHealthRecordImport,
} from '@/import';
import { useDisclosureFocus } from '../hooks';
import { CcdaReview } from './CcdaReview';
import { ClinicalBoundary } from './ClinicalBoundary';
import type { Catalog } from '@/domain/catalog';
import type { Condition, FamilyRecord } from '@/domain/types';

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
 * from. Passed explicitly to `beginConnect` so what's displayed here is exactly what's sent. */
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
    return "This doesn't look like a SMART-on-FHIR server (no authorization endpoints were found). Double-check the FHIR base URL.";
  }
  if (/state mismatch/i.test(message)) {
    return 'The sign-in could not be verified for safety and was cancelled. Try connecting again.';
  }
  if (/Token request failed/i.test(message)) {
    return `Sign-in with this provider failed (${message}). Try connecting again, and confirm the redirect URI above is registered with your provider exactly as shown.`;
  }
  if (/FHIR read failed/i.test(message)) {
    return `The server rejected the data request (${message}). Your access may have expired — try syncing again, or disconnect and reconnect.`;
  }
  if (/reauthorized/i.test(message)) {
    return message;
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

/** One connected provider: status, scopes, sync/disconnect controls, and its own sync error
 * (each connection syncs independently, so one failing must never block or hide the others). */
function ConnectionCard({
  connection,
  syncing,
  syncError,
  onSync,
  onDisconnect,
  onSetStayConnected,
}: {
  connection: SmartConnection;
  syncing: boolean;
  syncError: string | null;
  onSync: (id: string) => void;
  onDisconnect: (id: string) => void;
  onSetStayConnected: (id: string, stayConnected: boolean) => void;
}) {
  const stayId = useId();
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
          className="btn btn--primary btn--sm"
          onClick={() => onSync(connection.id)}
          aria-disabled={syncing}
        >
          {syncing ? 'Syncing…' : 'Sync now'}
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
        <button type="button" className="btn btn--sm" onClick={() => onDisconnect(connection.id)}>
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

  const [fhirBaseUrl, setFhirBaseUrl] = useState('');
  const [clientId, setClientId] = useState('');
  const [stayConnectedOptIn, setStayConnectedOptIn] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [addingAnother, setAddingAnother] = useState(false);
  const [copied, setCopied] = useState(false);

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
  const redirectInputId = useId();
  const connectErrorId = useId();

  const copyTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (copyTimer.current != null) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  const showConnectForm = connections.length === 0 || addingAnother;
  const uri = redirectUri();

  const copyRedirectUri = async (): Promise<void> => {
    try {
      await navigator.clipboard?.writeText(uri);
      setCopied(true);
      if (copyTimer.current != null) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable (permissions, insecure context) — the value is still
      // visible and selectable in the field, so this is a soft failure, not an error state.
    }
  };

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
    const trimmedClient = clientId.trim();
    if (!trimmedBase || !trimmedClient) {
      setConnectError('Enter both the FHIR base URL and the client ID your provider issued.');
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
      if (parsed.proband.problems.length === 0 && parsed.familyMembers.length === 0) {
        setSyncErrors((prev) => ({
          ...prev,
          [connectionId]: 'No conditions or family history were found for this patient.',
        }));
        return;
      }
      setSyncStatus(
        `Synced ${parsed.proband.problems.length} ${
          parsed.proband.problems.length === 1 ? 'condition' : 'conditions'
        } and ${parsed.familyMembers.length} ${
          parsed.familyMembers.length === 1 ? 'family member' : 'family members'
        } — review below.`,
      );
      setStaged(stageHealthRecordImport(parsed, record, catalog));
    } catch (err) {
      setSyncErrors((prev) => ({ ...prev, [connectionId]: friendlyError(err, 'sync') }));
    } finally {
      setSyncingId(null);
    }
  };

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
        Connect directly to your patient portal&rsquo;s FHIR server (Epic MyChart, Cerner, and most
        US portals support this) using the SMART-on-FHIR standard. You sign in with your provider,
        not Stemma, and choose exactly what to bring in before anything is added.
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
          <div>
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
              aria-describedby={connectError ? `${baseUrlHintId} ${connectErrorId}` : baseUrlHintId}
              aria-invalid={Boolean(connectError)}
              value={fhirBaseUrl}
              onChange={(e) => setFhirBaseUrl(e.target.value)}
            />
            <p id={baseUrlHintId} className="mono-dim" style={{ marginTop: 6 }}>
              Your provider&rsquo;s FHIR endpoint — found on their developer portal (e.g. Epic on
              FHIR, Cerner Code) or given to you when you registered Stemma as an app.
            </p>
          </div>

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
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            />
            <p id={clientIdHintId} className="mono-dim" style={{ marginTop: 6 }}>
              Issued when you register Stemma with your provider — Stemma has no client ID of its
              own since every install is a separate registration you control.
            </p>
          </div>

          <div>
            <label className="lbl" htmlFor={redirectInputId}>
              Redirect URI to register with your provider
            </label>
            <div className="row" style={{ gap: 8 }}>
              {/* A `readOnly` text input, not a `<code>` block — natively focusable and
                  keyboard-selectable (Tab to it, Ctrl/Cmd+A or the auto-select-on-focus
                  below), unlike a `<code>` element which a keyboard user can't reach or
                  select text from at all. The Copy button remains as the one-step
                  convenience path. */}
              <input
                id={redirectInputId}
                className="field mono"
                type="text"
                readOnly
                aria-label="Redirect URI to register with your provider"
                onFocus={(e) => e.currentTarget.select()}
                value={uri}
              />
              <button type="button" className="btn btn--sm" onClick={() => void copyRedirectUri()}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            {/* Visually-hidden confirmation — the "Copied" button-label swap above is
                sighted-only feedback; a screen-reader user gets nothing from a button
                label mutating on its own (WCAG 4.1.3). Always rendered (never
                mounted/unmounted) so the mutation is announced rather than possibly
                missed as an already-populated region. */}
            <span role="status" className="visually-hidden">
              {copied ? 'Copied' : ''}
            </span>
            <p className="mono-dim" style={{ marginTop: 6 }}>
              When registering Stemma as an app, this exact URL must be entered as the
              redirect/callback URI — registration requires an exact match, including the trailing
              slash.
            </p>
          </div>

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
