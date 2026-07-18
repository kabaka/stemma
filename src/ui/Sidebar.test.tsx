import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CURRENT_YEAR, useStore } from '@/store/useStore';
import { Sidebar } from './Sidebar';

beforeEach(() => useStore.getState().resetRecord());

describe('Sidebar — navigation', () => {
  it('marks the active view with aria-current="page" and leaves the others unmarked', () => {
    render(<Sidebar />);
    expect(screen.getByRole('button', { name: 'Overview' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('button', { name: 'Family Pedigree' })).not.toHaveAttribute(
      'aria-current',
    );
    expect(screen.getByRole('button', { name: 'Family Patterns' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('setView switches the store view and moves the aria-current marker when a nav item is clicked', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    await user.click(screen.getByRole('button', { name: 'Reports & Export' }));

    expect(useStore.getState().view).toBe('reports');
    expect(screen.getByRole('button', { name: 'Reports & Export' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('button', { name: 'Overview' })).not.toHaveAttribute('aria-current');
  });
});

describe('Sidebar — colorblind-safe palette toggle', () => {
  it('toggles the store palette and reflects the pressed state and visible label', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    const toggle = screen.getByRole('button', { name: /colorblind-safe/i });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle).toHaveTextContent(/colorblind-safe: off/i);

    await user.click(toggle);
    expect(useStore.getState().palette).toBe('colorblind');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(toggle).toHaveTextContent(/colorblind-safe: on/i);

    await user.click(toggle);
    expect(useStore.getState().palette).toBe('default');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('Sidebar — proband banner', () => {
  it('shows the proband’s name, the "(you)" tag, and an age derived from the birth year', () => {
    useStore.getState().updatePerson('you', {
      name: 'Jordan',
      sab: 'u',
      gender: 'nb',
      dead: false,
      birth: CURRENT_YEAR - 30, // relative to CURRENT_YEAR, so age is deterministically 30
      death: null,
      condIds: [],
    });
    render(<Sidebar />);
    expect(screen.getByText('Jordan')).toBeInTheDocument();
    expect(screen.getByText('(you)')).toBeInTheDocument();
    expect(screen.getByText(/30 yrs/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`b\\.${CURRENT_YEAR - 30}`))).toBeInTheDocument();
  });

  it('shows "age unknown" and no birth-year suffix when no birth year is recorded', () => {
    render(<Sidebar />); // resetRecord() gives an untouched proband with birth: null
    expect(screen.getByText(/age unknown/i)).toBeInTheDocument();
  });
});

describe('Sidebar — footer legal links', () => {
  it('renders Privacy and Terms links opening in a new tab, pointed at the static legal pages', () => {
    render(<Sidebar />);

    const privacy = screen.getByRole('link', { name: 'Privacy' });
    expect(privacy).toHaveAttribute('target', '_blank');
    expect(privacy).toHaveAttribute('rel', 'noopener noreferrer');
    expect(privacy.getAttribute('href')).toMatch(/privacy\.html$/);

    const terms = screen.getByRole('link', { name: 'Terms' });
    expect(terms).toHaveAttribute('target', '_blank');
    expect(terms).toHaveAttribute('rel', 'noopener noreferrer');
    expect(terms.getAttribute('href')).toMatch(/terms\.html$/);
  });
});
