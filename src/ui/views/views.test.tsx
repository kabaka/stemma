import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useStore } from '@/store/useStore';
import { OverviewView } from './OverviewView';
import { PatternsView } from './PatternsView';
import { TimelineView } from './TimelineView';
import { PedigreeView } from './PedigreeView';

beforeEach(() => useStore.getState().resetRecord());

describe('OverviewView', () => {
  it('renders headline stats and the top hereditary flag', () => {
    render(<OverviewView />);
    expect(screen.getByRole('heading', { name: /health overview/i })).toBeInTheDocument();
    expect(screen.getByText(/relatives tracked/i)).toBeInTheDocument();
    // The seed pedigree clusters breast cancer → HBOC referral flag.
    expect(screen.getByText(/hereditary breast/i)).toBeInTheDocument();
  });

  it('states the clinical boundary', () => {
    render(<OverviewView />);
    expect(screen.getByText(/not a diagnostic device/i)).toBeInTheDocument();
  });

  it('marks section labels as real headings for screen-reader navigation', () => {
    render(<OverviewView />);
    expect(
      screen.getByRole('heading', { name: /family history flags/i, level: 2 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /screening status/i, level: 2 }),
    ).toBeInTheDocument();
  });
});

describe('PatternsView', () => {
  it('renders detected patterns and the per-condition findings', () => {
    render(<PatternsView />);
    expect(screen.getByRole('heading', { name: /family patterns/i })).toBeInTheDocument();
    expect(screen.getByText(/detected patterns/i)).toBeInTheDocument();
    expect(screen.getByText(/per-condition family findings/i)).toBeInTheDocument();
  });
});

describe('TimelineView', () => {
  it("shows the proband's timeline events", () => {
    render(<TimelineView />);
    expect(screen.getByRole('heading', { name: /my health timeline/i })).toBeInTheDocument();
    // A seed event for Maya.
    expect(screen.getByText(/started levothyroxine/i)).toBeInTheDocument();
  });

  it('gives the unlabelled person switcher an accessible name', () => {
    render(<TimelineView />);
    // Placeholder-only control (no visible text label) — must still resolve a name.
    expect(screen.getByRole('combobox', { name: /select person/i })).toBeInTheDocument();
  });
});

describe('PedigreeView', () => {
  it('renders every person as a keyboard-operable, named pedigree node', () => {
    render(<PedigreeView />);
    // The chart is a labelled group (not role="img", which would hide the nodes from AT).
    const chart = screen.getByRole('group', { name: /family pedigree/i });
    // Nodes are real buttons, so they're focusable and operable without a pointer.
    expect(within(chart).getByRole('button', { name: /Maya/i })).toBeInTheDocument();
    const robert = within(chart).getByRole('button', { name: /Robert/i });
    expect(robert).toBeInTheDocument();
    expect(robert).toHaveAttribute('tabindex', '0');
  });

  it('names affected nodes with the condition and category, not colour alone', () => {
    render(<PedigreeView />);
    // Seed data: Robert's first recorded condition is coronary heart disease (cardiovascular).
    expect(
      screen.getByRole('button', {
        name: /Robert, affected: Coronary heart disease \(cardiovascular\)/i,
      }),
    ).toBeInTheDocument();
  });

  it('renders a category-colour legend near the chart', () => {
    render(<PedigreeView />);
    expect(screen.getByRole('list', { name: /condition category legend/i })).toBeInTheDocument();
  });

  it('opens the person editor as a labelled dialog and focuses it', async () => {
    const user = userEvent.setup();
    render(<PedigreeView />);
    await user.click(screen.getByRole('button', { name: /Maya/i }));
    const dialog = screen.getByRole('dialog', { name: /Maya/i });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveFocus();
  });
});
