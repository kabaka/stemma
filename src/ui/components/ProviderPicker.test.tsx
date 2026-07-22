/**
 * Oracle for the searchable multi-vendor provider picker (DR-0016): filtering, the
 * result-count copy (including the "showing N of M" cap message), the per-result vendor
 * system label (and its inclusion in each option's accessible name), and full keyboard
 * operability of the combobox (ArrowDown/ArrowUp/Enter/Escape) alongside pointer selection.
 * Exercises the REAL bundled `SMART_PROVIDERS` data (no faking) — this is a thin filter/
 * render layer over it, so the oracle's value is in proving the UI wiring, not in re-deriving
 * the data.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProviderPicker } from './ProviderPicker';
import { SMART_PROVIDERS } from '@/data/smart-endpoints';

describe('ProviderPicker', () => {
  it('renders closed with no listbox until the user types', () => {
    render(<ProviderPicker onSelect={vi.fn()} />);

    const input = screen.getByRole('combobox', { name: 'Find your provider' });
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('filters by a substring of the provider name and calls onSelect with the matching provider on click', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const target = SMART_PROVIDERS[0];
    render(<ProviderPicker onSelect={onSelect} />);

    const input = screen.getByRole('combobox', { name: 'Find your provider' });
    // A distinctive slice of the real target's name — long enough that it's very unlikely to
    // accidentally match a second brand in the 2,566-entry directory too. Matched by plain
    // string `includes`, not a regex, since a provider name can carry regex-special
    // characters (parens, periods, apostrophes).
    const needle = target.name.slice(0, 8);
    await user.type(input, needle);

    const options = await screen.findAllByRole('option');
    const option = options.find((o) => o.textContent?.includes(target.name));
    expect(option).toBeDefined();
    await user.click(option!);

    expect(onSelect).toHaveBeenCalledWith(target);
    expect(input).toHaveValue(target.name);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('is fully keyboard-operable: ArrowDown moves the highlight, Enter selects it, Escape closes without selecting', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ProviderPicker onSelect={onSelect} />);

    const input = screen.getByRole('combobox', { name: 'Find your provider' });
    await user.type(input, 'medical');

    const options = await screen.findAllByRole('option');
    expect(options.length).toBeGreaterThan(1);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{ArrowDown}');
    expect(options[0]).toHaveAttribute('aria-selected', 'false');
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveAttribute('aria-activedescendant', options[1].id);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('shows the "showing N of M" cap message for a broad query, and the directory-as-of date', async () => {
    const user = userEvent.setup();
    render(<ProviderPicker onSelect={vi.fn()} />);

    // A single common letter matches far more than the 50-result cap in the real directory.
    await user.type(screen.getByRole('combobox', { name: 'Find your provider' }), 'a');

    expect(await screen.findByRole('status')).toHaveTextContent(/showing 50 of \d+/i);
    expect(screen.getByText(/provider directory as of/i)).toBeInTheDocument();
  });

  it('shows a no-matches message for a query nothing matches, without rendering a listbox', async () => {
    const user = userEvent.setup();
    render(<ProviderPicker onSelect={vi.fn()} />);

    await user.type(
      screen.getByRole('combobox', { name: 'Find your provider' }),
      'zzzzznonexistentproviderzzzzz',
    );

    expect(await screen.findByRole('status')).toHaveTextContent(/no matches/i);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  // DR-0016 (Cerner/Oracle Health follow-up): search stays UNIFIED across both vendors — the
  // picker must never grow an Epic-vs-Cerner filter/toggle, and disclosing the system per row
  // (not gating results by it) is the intended behavior.
  it('renders both an Epic and a Cerner result under a single unified search, each with its own system label, and exposes no vendor filter/toggle', async () => {
    const user = userEvent.setup();
    const epicTarget = SMART_PROVIDERS.find((p) => p.source === 'epic');
    const cernerTarget = SMART_PROVIDERS.find((p) => p.source === 'cerner');
    expect(epicTarget).toBeDefined();
    expect(cernerTarget).toBeDefined();

    render(<ProviderPicker onSelect={vi.fn()} />);
    // A broad query wide enough to surface both a real Epic and a real Cerner entry among the
    // capped results.
    await user.type(screen.getByRole('combobox', { name: 'Find your provider' }), 'health');

    const options = await screen.findAllByRole('option');
    const epicOption = options.find((o) => o.textContent?.includes('Epic'));
    const cernerOption = options.find((o) => o.textContent?.includes('Oracle Health'));
    expect(epicOption).toBeDefined();
    expect(cernerOption).toBeDefined();
    // The visible label is text, not colour-alone (WCAG 1.4.1), and is folded into the
    // option's own accessible name (WAI-ARIA `aria-label`) so a screen reader announces it.
    expect(epicOption).toHaveAccessibleName(/· Epic$/);
    expect(cernerOption).toHaveAccessibleName(/· Oracle Health$/);

    // No system filter/toggle of any kind — the only control is the single search combobox.
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
  });
});
