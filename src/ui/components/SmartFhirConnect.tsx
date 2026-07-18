import { useEffect, useId, useRef, useState } from 'react';
import { useSmartConnectionStore, type SmartConnection } from '@/store/useSmartConnectionStore';
import {
  applyHealthRecordImport,
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

  const headingRef = useDisclosureFocus<HTMLHeadingElement>();
  const baseUrlId = useId();
  const baseUrlHintId = useId();
  const clientIdId = useId();
  const clientIdHintId = useId();
  const redirectHintId = useId();

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
    setConnectError(null);
    const trimmedBase = fhirBaseUrl.trim();
    const trimmedClient = clientId.trim();
    if (!trimmedBase || !trimmedClient) {
      setConnectError('Enter both the FHIR base URL and the client ID your provider issued.');
      return;
    }
    try {
      // eslint-disable-next-line no-new -- validated for its side effect (throws on a malformed URL)
      new URL(trimmedBase);
    } catch {
      setConnectError('That doesn’t look like a valid URL — it should start with https://.');
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
    setSyncErrors((prev) => {
      if (!(connectionId in prev)) return prev;
      const rest = { ...prev };
      delete rest[connectionId];
      return rest;
    });
    setSyncingId(connectionId);
    try {
      const parsed = await syncNow(connectionId);
      if (parsed.proband.problems.length === 0 && parsed.familyMembers.length === 0) {
        setSyncErrors((prev) => ({
          ...prev,
          [connectionId]: 'No conditions or family history were found for this patient.',
        }));
        return;
      }
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
        <h2 className="overline" tabIndex={-1} ref={headingRef} style={{ margin: 0 }}>
          Review synced health record
        </h2>
        <CcdaReview staged={staged} record={record} onConfirm={handleConfirm} onCancel={onCancel} />
      </div>
    );
  }

  return (
    <div className="card" style={{ marginBottom: 16, display: 'grid', gap: 14 }}>
      <h2 className="overline" tabIndex={-1} ref={headingRef} style={{ margin: 0 }}>
        Connect a health record (SMART on FHIR)
      </h2>
      <p className="mono-dim" style={{ margin: 0, lineHeight: 1.5 }}>
        Connect directly to your patient portal&rsquo;s FHIR server (Epic MyChart, Cerner, and most
        US portals support this) using the SMART-on-FHIR standard. You sign in with your provider,
        not Stemma, and choose exactly what to bring in before anything is added.
      </p>

      <ClinicalBoundary />

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
              aria-describedby={baseUrlHintId}
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
              aria-describedby={clientIdHintId}
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            />
            <p id={clientIdHintId} className="mono-dim" style={{ marginTop: 6 }}>
              Issued when you register Stemma with your provider — Stemma has no client ID of its
              own since every install is a separate registration you control.
            </p>
          </div>

          <div>
            <span className="lbl" id={redirectHintId}>
              Redirect URI to register with your provider
            </span>
            <div className="row" style={{ gap: 8 }}>
              <code
                aria-labelledby={redirectHintId}
                style={{
                  background: 'var(--bg)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: 7,
                  padding: '8px 10px',
                  flex: 1,
                  minWidth: 0,
                  fontSize: 12.5,
                  wordBreak: 'break-all',
                  userSelect: 'all',
                }}
              >
                {uri}
              </code>
              <button type="button" className="btn btn--sm" onClick={() => void copyRedirectUri()}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
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
            <div className="disclaimer" role="alert">
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
          <button type="button" className="btn btn--sm" onClick={() => setAddingAnother(true)}>
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
