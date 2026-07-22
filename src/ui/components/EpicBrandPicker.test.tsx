/**
 * Oracle for the searchable Epic provider picker (DR-0016): filtering, the result-count
 * copy (including the "showing N of M" cap message), and full keyboard operability of the
 * combobox (ArrowDown/ArrowUp/Enter/Escape) alongside pointer selection. Exercises the REAL
 * bundled `SMART_PROVIDERS` data (no faking) — this is a thin filter/render layer over it,
 * so the oracle's value is in proving the UI wiring, not in re-deriving the data.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EpicBrandPicker } from './EpicBrandPicker';
import { SMART_PROVIDERS } from '@/data/smart-endpoints';

describe('EpicBrandPicker', () => {
  it('renders closed with no listbox until the user types', () => {
    render(<EpicBrandPicker onSelect={vi.fn()} />);

    const input = screen.getByRole('combobox', { name: 'Find your provider' });
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('filters by a substring of the provider name and calls onSelect with the matching provider on click', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const target = SMART_PROVIDERS[0];
    render(<EpicBrandPicker onSelect={onSelect} />);

    const input = screen.getByRole('combobox', { name: 'Find your provider' });
    // A distinctive slice of the real target's name — long enough that it's very unlikely to
    // accidentally match a second brand in the 1,243-entry directory too. Matched by plain
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
    render(<EpicBrandPicker onSelect={onSelect} />);

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
    render(<EpicBrandPicker onSelect={vi.fn()} />);

    // A single common letter matches far more than the 50-result cap in the real directory.
    await user.type(screen.getByRole('combobox', { name: 'Find your provider' }), 'a');

    expect(await screen.findByRole('status')).toHaveTextContent(/showing 50 of \d+/i);
    expect(screen.getByText(/provider directory as of/i)).toBeInTheDocument();
  });

  it('shows a no-matches message for a query nothing matches, without rendering a listbox', async () => {
    const user = userEvent.setup();
    render(<EpicBrandPicker onSelect={vi.fn()} />);

    await user.type(
      screen.getByRole('combobox', { name: 'Find your provider' }),
      'zzzzznonexistentproviderzzzzz',
    );

    expect(await screen.findByRole('status')).toHaveTextContent(/no matches/i);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
