import { useEffect, useRef } from 'react';
import { useStore } from '@/store/useStore';
import { useSmartConnectionStore } from '@/store/useSmartConnectionStore';
import { Sidebar } from './Sidebar';
import { OverviewView } from './views/OverviewView';
import { PedigreeView } from './views/PedigreeView';
import { PatternsView } from './views/PatternsView';
import { TimelineView } from './views/TimelineView';
import { ReportsView } from './views/ReportsView';
import { HistoryView } from './views/HistoryView';
import { PrintReports } from './components/PrintReports';

/** Root shell: a fixed sidebar and the active view. */
export function App() {
  const view = useStore((s) => s.view);
  const mainRef = useRef<HTMLElement>(null);
  const completeSmartCallback = useSmartConnectionStore((s) => s.completeCallbackIfPresent);

  // Mount-once: if the page URL carries an OAuth `code`+`state` from a SMART-on-FHIR redirect,
  // finish the handshake (verify `state`, exchange the code, strip the query via
  // `history.replaceState`) before anything else runs. Idempotent — a no-op once the query
  // params are gone, so it's safe to keep this unconditional rather than gate it on the current
  // view. It only ever writes connection metadata to `useSmartConnectionStore`, never touches
  // `useStore`'s record (`syncNow`'s parsed result is applied only after the user reviews and
  // confirms it — see `SmartFhirConnect`), so it can never clobber the pedigree on any reload.
  useEffect(() => {
    completeSmartCallback().catch((err: unknown) => {
      // Nowhere else to surface this at mount time (no view is guaranteed interactive yet, and
      // a failed handshake here means the connect panel never opened) — log rather than swallow.
      console.error('SMART-on-FHIR callback failed:', err);
    });
  }, [completeSmartCallback]);
  // Each view swap unmounts the old view and mounts the new one (see the conditional
  // renders below), but nothing was moving keyboard/screen-reader focus to the new
  // page — a sighted mouse user sees the change; anyone else has to go hunting for it.
  // Move focus to the new view's own <h1> (every view's `.page-title` carries
  // `tabIndex={-1}` for exactly this) on every navigation, mirroring the ref+focus
  // discipline PedigreeView already uses for its own internal transitions (WCAG 2.4.3).
  //
  // Tracks the previous `view` rather than a "first render" boolean latch: React 18
  // StrictMode (dev only) mounts, cleanup-unmounts, and remounts every component once,
  // which would flip a boolean latch to false during that first throwaway mount — so the
  // real mount that immediately follows (still the *same* initial `view`) would find the
  // latch already false and wrongly steal focus to <h1> on first page load. Comparing
  // against the previous view is immune: prevView.current === view on both the throwaway
  // and the real mount (nothing to focus either time), and only a genuine navigation ever
  // makes them differ.
  const prevView = useRef(view);
  useEffect(() => {
    if (prevView.current !== view) {
      mainRef.current?.querySelector<HTMLElement>('.page-title')?.focus();
    }
    prevView.current = view;
  }, [view]);

  return (
    <>
      <div className="app">
        <Sidebar />
        <main className="main" ref={mainRef}>
          {view === 'overview' && <OverviewView />}
          {view === 'tree' && <PedigreeView />}
          {view === 'patterns' && <PatternsView />}
          {view === 'timeline' && <TimelineView />}
          {view === 'reports' && <ReportsView />}
          {view === 'history' && <HistoryView />}
        </main>
      </div>
      {/* Rendered as a sibling of the app shell so `@media print` can hide the dark chrome
          and reveal only these black-on-white clinical sheets (see components.css). */}
      <PrintReports />
    </>
  );
}
