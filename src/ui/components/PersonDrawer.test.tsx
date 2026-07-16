import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useStore } from '@/store/useStore';
import { PersonDrawer } from './PersonDrawer';

// All tests operate on the example family.
beforeEach(() => useStore.getState().loadSample());
afterEach(() => vi.restoreAllMocks());

/** The seed's Robert+Susan union — a real 2-parent union with 3 children (Jack, Maya,
 * Emma) — is the fixture every test below drives; no consanguinity/twins set initially. */
const robertSusanUnion = () =>
  useStore
    .getState()
    .record.unions.find((u) => u.parents.includes('robert') && u.parents.includes('susan'))!;

describe('PersonDrawer — Union details: consanguineous checkbox', () => {
  it('checking it calls updateUnion(union.parents, { consanguineous: true })', async () => {
    const user = userEvent.setup();
    render(<PersonDrawer personId="robert" onOpenForm={vi.fn()} />);
    const checkbox = screen.getByRole('checkbox', { name: /consanguineous union/i });
    expect(checkbox).not.toBeChecked();
    expect(robertSusanUnion().consanguineous).not.toBe(true);

    await user.click(checkbox);

    // Assert via the store — the actual mutation path, not just the checked DOM attribute.
    expect(robertSusanUnion().consanguineous).toBe(true);
    expect(screen.getByRole('checkbox', { name: /consanguineous union/i })).toBeChecked();
  });

  it('unchecking it clears the flag back via the same updateUnion path', async () => {
    const user = userEvent.setup();
    act(() => useStore.getState().updateUnion(['robert', 'susan'], { consanguineous: true }));
    render(<PersonDrawer personId="robert" onOpenForm={vi.fn()} />);
    const checkbox = screen.getByRole('checkbox', { name: /consanguineous union/i });
    expect(checkbox).toBeChecked();

    await user.click(checkbox);

    expect(robertSusanUnion().consanguineous).toBe(false);
  });
});

describe('PersonDrawer — Union details: mark as twins', () => {
  it('writes a twins entry with the selected members and chosen zygosity', async () => {
    const user = userEvent.setup();
    render(<PersonDrawer personId="robert" onOpenForm={vi.fn()} />);
    const group = screen.getByRole('group', { name: /twin \/ multiple-birth grouping/i });

    await user.click(within(group).getByRole('checkbox', { name: 'Jack' }));
    await user.click(within(group).getByRole('checkbox', { name: 'Maya' }));
    await user.click(screen.getByRole('radio', { name: /identical \(monozygotic\)/i }));
    await user.click(screen.getByRole('button', { name: /mark as twins/i }));

    const twins = robertSusanUnion().twins;
    expect(twins).toHaveLength(1);
    // Compare as sets — selection order isn't the contract, membership and zygosity are.
    expect(new Set(twins![0].members)).toEqual(new Set(['jack', 'you']));
    expect(twins![0].zygosity).toBe('mono');
  });

  it('defaults to fraternal (dizygotic) when the zygosity radio is left untouched', async () => {
    const user = userEvent.setup();
    render(<PersonDrawer personId="robert" onOpenForm={vi.fn()} />);
    const group = screen.getByRole('group', { name: /twin \/ multiple-birth grouping/i });

    await user.click(within(group).getByRole('checkbox', { name: 'Jack' }));
    await user.click(within(group).getByRole('checkbox', { name: 'Emma' }));
    await user.click(screen.getByRole('button', { name: /mark as twins/i }));

    expect(robertSusanUnion().twins).toEqual([{ members: ['jack', 'emma'], zygosity: 'di' }]);
  });

  it('disables "Mark as twins" until at least two children are selected', async () => {
    const user = userEvent.setup();
    render(<PersonDrawer personId="robert" onOpenForm={vi.fn()} />);
    const group = screen.getByRole('group', { name: /twin \/ multiple-birth grouping/i });
    const markBtn = screen.getByRole('button', { name: /mark as twins/i });
    expect(markBtn).toBeDisabled();

    await user.click(within(group).getByRole('checkbox', { name: 'Jack' }));
    expect(markBtn).toBeDisabled(); // still only one selected

    await user.click(within(group).getByRole('checkbox', { name: 'Maya' }));
    expect(markBtn).toBeEnabled();

    // Deselecting back down to one re-disables it.
    await user.click(within(group).getByRole('checkbox', { name: 'Maya' }));
    expect(markBtn).toBeDisabled();
  });

  it('disables a child already claimed by an existing twin set — can’t be double-claimed', () => {
    act(() =>
      useStore.getState().updateUnion(['robert', 'susan'], {
        twins: [{ members: ['jack', 'you'], zygosity: 'di' }],
      }),
    );
    render(<PersonDrawer personId="robert" onOpenForm={vi.fn()} />);
    const group = screen.getByRole('group', { name: /twin \/ multiple-birth grouping/i });

    expect(within(group).getByRole('checkbox', { name: 'Jack' })).toBeDisabled();
    expect(within(group).getByRole('checkbox', { name: 'Maya' })).toBeDisabled();
    // Emma isn't in any twin set yet — stays selectable.
    expect(within(group).getByRole('checkbox', { name: 'Emma' })).toBeEnabled();
  });

  it('removing an existing twin set calls updateUnion and clears it', async () => {
    const user = userEvent.setup();
    act(() =>
      useStore.getState().updateUnion(['robert', 'susan'], {
        twins: [{ members: ['jack', 'you'], zygosity: 'di' }],
      }),
    );
    render(<PersonDrawer personId="robert" onOpenForm={vi.fn()} />);
    expect(robertSusanUnion().twins).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: /remove twin set/i }));

    expect(robertSusanUnion().twins).toEqual([]);
  });
});
