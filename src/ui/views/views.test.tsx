import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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
});

describe('PedigreeView', () => {
  it('renders every person as a pedigree node', () => {
    render(<PedigreeView />);
    const chart = screen.getByRole('img', { name: /family pedigree/i });
    // The proband and a known relative are labelled.
    expect(within(chart).getByText('Maya')).toBeInTheDocument();
    expect(within(chart).getByText('Robert')).toBeInTheDocument();
  });
});
