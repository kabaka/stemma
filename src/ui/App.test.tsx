import { StrictMode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useStore } from '@/store/useStore';
import { App } from './App';

beforeEach(() => useStore.getState().resetRecord());

describe('App — navigation', () => {
  it('renders the view matching the current store state and marks its nav item aria-current', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: /health overview/i, level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Overview' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('switching views via the sidebar updates the store, aria-current, and renders the new view', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Family Pedigree' }));

    expect(useStore.getState().view).toBe('tree');
    expect(screen.getByRole('button', { name: 'Family Pedigree' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('heading', { name: /family pedigree/i, level: 1 })).toBeInTheDocument();
    // The previous view's page is gone — each view swap unmounts the old one.
    expect(screen.queryByRole('heading', { name: /health overview/i })).not.toBeInTheDocument();
  });

  it("routes every nav item to its own view (App's full view === ... switch table)", async () => {
    const user = userEvent.setup();
    render(<App />);
    const cases: [navLabel: string, view: string, headingPattern: RegExp][] = [
      ['Family Patterns', 'patterns', /family patterns/i],
      ['My Timeline', 'timeline', /my health timeline/i],
      ['Reports & Export', 'reports', /reports & export/i],
      ['Family Pedigree', 'tree', /family pedigree/i],
      ['Overview', 'overview', /health overview/i],
    ];
    for (const [navLabel, view, headingPattern] of cases) {
      await user.click(screen.getByRole('button', { name: navLabel }));
      expect(useStore.getState().view).toBe(view);
      expect(screen.getByRole('heading', { name: headingPattern, level: 1 })).toBeInTheDocument();
    }
  });

  it('does not steal focus to the heading on first render, but moves it there on navigation (WCAG 2.4.3)', async () => {
    const user = userEvent.setup();
    render(<App />);
    // Skipped on the very first render — nothing has forced focus onto the page heading.
    expect(document.body).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'My Timeline' }));
    // Every subsequent navigation moves focus to the new view's own <h1>.
    expect(screen.getByRole('heading', { name: /my health timeline/i, level: 1 })).toHaveFocus();
  });
});

describe('App — StrictMode focus safety (regression)', () => {
  // [HIGH, review-gate] The old code tracked "is this the first render" with a plain
  // `useRef(true)` boolean latch, flipped to false inside the focus effect. React 18
  // StrictMode (dev only) mounts every effect-bearing component, immediately fake-
  // unmounts it (running cleanups) and fake-remounts it (rerunning effects) once, all
  // using the SAME component instance and hook state — so that boolean flipped to
  // `false` during the throwaway cycle, and the real mount that followed (still the same
  // initial `view`) found the latch already spent and wrongly focused the page heading on
  // first load. A plain, non-StrictMode `render(<App/>)` (see the "does not steal focus…"
  // test above) never exercises this — only wrapping in `<React.StrictMode>` reproduces
  // dev-mode's double-invoke and would have caught the regression.
  beforeEach(() => useStore.getState().setView('overview'));

  it('does not steal focus to the page heading on initial mount under StrictMode', () => {
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    expect(document.body).toHaveFocus();
    expect(screen.getByRole('heading', { name: /health overview/i, level: 1 })).not.toHaveFocus();
  });

  it('still moves focus to the new view’s heading on a real navigation under StrictMode', async () => {
    const user = userEvent.setup();
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    await user.click(screen.getByRole('button', { name: 'My Timeline' }));
    expect(screen.getByRole('heading', { name: /my health timeline/i, level: 1 })).toHaveFocus();
  });
});
