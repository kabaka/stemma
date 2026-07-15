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
  return (
    <>
      <div className="app">
        <Sidebar />
        <main className="main">
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
