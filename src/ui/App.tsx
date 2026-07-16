import { useEffect, useRef } from 'react';
import { useStore } from '@/store/useStore';
import { Sidebar } from './Sidebar';
import { OverviewView } from './views/OverviewView';
import { PedigreeView } from './views/PedigreeView';
import { PatternsView } from './views/PatternsView';
import { TimelineView } from './views/TimelineView';
import { ReportsView } from './views/ReportsView';
import { PrintReports } from './components/PrintReports';

/** Root shell: a fixed sidebar and the active view. */
export function App() {
  const view = useStore((s) => s.view);
  const mainRef = useRef<HTMLElement>(null);
  // Each view swap unmounts the old view and mounts the new one (see the conditional
  // renders below), but nothing was moving keyboard/screen-reader focus to the new
  // page — a sighted mouse user sees the change; anyone else has to go hunting for it.
  // Move focus to the new view's own <h1> (every view's `.page-title` carries
  // `tabIndex={-1}` for exactly this) on every navigation, mirroring the ref+focus
  // discipline PedigreeView already uses for its own internal transitions (WCAG 2.4.3).
  // Skipped on the very first render so initial page load doesn't steal focus from
  // wherever the browser naturally placed it.
  const isFirstView = useRef(true);
  useEffect(() => {
    if (isFirstView.current) {
      isFirstView.current = false;
      return;
    }
    mainRef.current?.querySelector<HTMLElement>('.page-title')?.focus();
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
        </main>
      </div>
      {/* Rendered as a sibling of the app shell so `@media print` can hide the dark chrome
          and reveal only these black-on-white clinical sheets (see components.css). */}
      <PrintReports />
    </>
  );
}
