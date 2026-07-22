import { beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import { useStore } from '@/store/useStore';
import type { FamilyRecord, Person, TimelineEvent } from '@/domain/types';
import { LabTrend } from './LabTrend';

beforeEach(() => useStore.getState().resetRecord());

function mkProband(overrides: Partial<Person> = {}): Person {
  return {
    id: 'you',
    name: 'Robin',
    sab: 'f',
    gender: 'woman',
    gen: 0,
    x: 0,
    dead: false,
    birth: 1980,
    death: null,
    isProband: true,
    conds: [],
    ...overrides,
  };
}

/** One lab title ("Glucose") with four readings across years, covering all four
 * `rangePosition` outcomes an out-of-range marker must (or must not) show for: strictly
 * above its own recorded high bound, strictly below its own recorded low bound, within
 * bounds, and no recorded range at all. Each reading's own bounds are used — never
 * borrowed from another year's reading (rangePosition's documented contract). */
function recordWithGlucoseSeries(): FamilyRecord {
  const proband = mkProband();
  const timeline: TimelineEvent[] = [
    {
      id: 'g-within',
      person: proband.id,
      year: 2020,
      type: 'lab',
      title: 'Glucose',
      detail: '',
      lab: { value: 90, unit: 'mg/dL', refLow: 70, refHigh: 100 },
    },
    {
      id: 'g-above',
      person: proband.id,
      year: 2021,
      type: 'lab',
      title: 'Glucose',
      detail: '',
      lab: { value: 150, unit: 'mg/dL', refLow: 70, refHigh: 100 },
    },
    {
      id: 'g-below',
      person: proband.id,
      year: 2022,
      type: 'lab',
      title: 'Glucose',
      detail: '',
      lab: { value: 50, unit: 'mg/dL', refLow: 70, refHigh: 100 },
    },
    {
      id: 'g-no-range',
      person: proband.id,
      year: 2023,
      type: 'lab',
      title: 'Glucose',
      detail: '',
      lab: { value: 80, unit: 'mg/dL' },
    },
  ];
  return { people: [proband], unions: [], timeline, probandId: proband.id };
}

describe('LabTrend', () => {
  it('marks a value above its own recorded refHigh with "above range"', () => {
    act(() => useStore.getState().replaceRecord(recordWithGlucoseSeries()));
    render(<LabTrend personId="you" />);
    const row = screen.getByRole('cell', { name: '2021' }).closest('tr') as HTMLElement;
    expect(within(row).getByText(/above range/i)).toBeInTheDocument();
  });

  it('marks a value below its own recorded refLow with "below range"', () => {
    act(() => useStore.getState().replaceRecord(recordWithGlucoseSeries()));
    render(<LabTrend personId="you" />);
    const row = screen.getByRole('cell', { name: '2022' }).closest('tr') as HTMLElement;
    expect(within(row).getByText(/below range/i)).toBeInTheDocument();
  });

  it('shows neither "above range" nor "below range" for a value within its recorded range', () => {
    act(() => useStore.getState().replaceRecord(recordWithGlucoseSeries()));
    render(<LabTrend personId="you" />);
    const row = screen.getByRole('cell', { name: '2020' }).closest('tr') as HTMLElement;
    expect(within(row).queryByText(/above range/i)).not.toBeInTheDocument();
    expect(within(row).queryByText(/below range/i)).not.toBeInTheDocument();
  });

  it('shows no marker at all for a reading with no recorded range', () => {
    act(() => useStore.getState().replaceRecord(recordWithGlucoseSeries()));
    render(<LabTrend personId="you" />);
    const row = screen.getByRole('cell', { name: '2023' }).closest('tr') as HTMLElement;
    expect(within(row).queryByText(/above range/i)).not.toBeInTheDocument();
    expect(within(row).queryByText(/below range/i)).not.toBeInTheDocument();
  });

  it('carries the caveat that an out-of-range marker is not by itself a diagnosis, and points to a clinician', () => {
    act(() => useStore.getState().replaceRecord(recordWithGlucoseSeries()));
    render(<LabTrend personId="you" />);
    expect(screen.getByText(/not by itself a diagnosis/i)).toBeInTheDocument();
    expect(screen.getByText(/discuss your results with a clinician/i)).toBeInTheDocument();
  });

  it('renders nothing when the person has no lab titles', () => {
    act(() =>
      useStore.getState().replaceRecord({
        people: [mkProband()],
        unions: [],
        timeline: [],
        probandId: 'you',
      }),
    );
    const { container } = render(<LabTrend personId="you" />);
    expect(container).toBeEmptyDOMElement();
  });
});
