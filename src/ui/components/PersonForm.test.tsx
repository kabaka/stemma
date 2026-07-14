import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useStore } from '@/store/useStore';
import { PersonForm, type PersonFormState } from './PersonForm';

// All tests operate on the example family.
beforeEach(() => useStore.getState().loadSample());
// Some tests spy on window.confirm (delete gating); restore so history can't leak.
afterEach(() => vi.restoreAllMocks());

describe('PersonForm — dialog semantics', () => {
  it('renders a labelled dialog and moves focus into it on open', () => {
    render(<PersonForm state={{ mode: 'edit', id: 'robert' }} onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: /edit robert/i });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveFocus();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<PersonForm state={{ mode: 'edit', id: 'robert' }} onClose={onClose} />);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on a backdrop click but not on a click inside the modal', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { container } = render(
      <PersonForm state={{ mode: 'edit', id: 'robert' }} onClose={onClose} />,
    );

    await user.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();

    await user.click(container.querySelector('.modal-backdrop')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Cancel closes without changing the record', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const before = useStore.getState().record.people.length;
    render(
      <PersonForm state={{ mode: 'add', anchor: 'you', relation: 'child' }} onClose={onClose} />,
    );

    await user.type(screen.getByRole('textbox', { name: /^name/i }), 'Nope');
    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(useStore.getState().record.people).toHaveLength(before);
  });

  it('Cancel in edit mode closes without mutating the person', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const before = { ...useStore.getState().record.people.find((p) => p.id === 'robert')! };
    render(<PersonForm state={{ mode: 'edit', id: 'robert' }} onClose={onClose} />);

    const nameField = screen.getByRole('textbox', { name: /^name/i });
    await user.clear(nameField);
    await user.type(nameField, 'Should Not Persist');
    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(useStore.getState().record.people.find((p) => p.id === 'robert')).toEqual(before);
  });

  it('returns focus to whatever opened it once it closes', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [state, setState] = useState<PersonFormState | null>(null);
      return (
        <div>
          <button onClick={() => setState({ mode: 'edit', id: 'robert' })}>Opener</button>
          {state && <PersonForm state={state} onClose={() => setState(null)} />}
        </div>
      );
    }
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Opener' }));
    expect(screen.getByRole('dialog')).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Opener' })).toHaveFocus();
  });
});

describe('PersonForm — focus trap, name stability & grouping', () => {
  it('Shift+Tab as the very first keystroke stays inside the dialog (does not escape to the page behind)', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <button>Control behind the modal</button>
        <PersonForm state={{ mode: 'edit', id: 'robert' }} onClose={vi.fn()} />
      </div>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveFocus();

    // Initial focus is on the tabIndex=-1 container, which isn't in the focusables ring —
    // the trap must still catch a backward Tab from there rather than let it walk out.
    await user.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(screen.getByRole('button', { name: 'Control behind the modal' })).not.toHaveFocus();
  });

  it('re-traps focus after the focused element is removed (remove a condition chip, then Tab)', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <button>Control behind the modal</button>
        <PersonForm state={{ mode: 'edit', id: 'robert' }} onClose={vi.fn()} />
      </div>,
    );
    const dialog = screen.getByRole('dialog');

    // Removing the focused chip button drops focus to <body>; the next Tab must land back
    // inside the dialog, not on the control rendered behind the backdrop.
    const removeBtn = screen.getByRole('button', { name: /remove hypertension/i });
    removeBtn.focus();
    await user.keyboard('{Enter}');
    await user.tab();

    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(screen.getByRole('button', { name: 'Control behind the modal' })).not.toHaveFocus();
  });

  it('keeps the dialog’s accessible name stable while the Name field is edited', async () => {
    const user = userEvent.setup();
    render(<PersonForm state={{ mode: 'edit', id: 'robert' }} onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName('Edit Robert');

    await user.type(screen.getByRole('textbox', { name: /^name/i }), 'X');
    // The visible field updates, but the dialog’s accessible name must not churn per
    // keystroke (a screen reader would otherwise re-announce it mid-edit).
    expect(dialog).toHaveAccessibleName('Edit Robert');
  });

  it('exposes the selected conditions as a labelled list, one item per condition', () => {
    // Robert has three recorded conditions in the seed (cad, htn, chol).
    render(<PersonForm state={{ mode: 'edit', id: 'robert' }} onClose={vi.fn()} />);
    const list = screen.getByRole('list', { name: /^conditions$/i });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
  });
});

describe('PersonForm — add vs. edit mode', () => {
  it('shows the Relative-of / Connect-as selects only in add mode, defaulted to what opened it', () => {
    render(
      <PersonForm
        state={{ mode: 'add', anchor: 'robert', relation: 'sibling' }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('combobox', { name: /relative of/i })).toHaveValue('robert');
    expect(screen.getByRole('combobox', { name: /connect as/i })).toHaveValue('sibling');
  });

  it('omits the anchor/relation selects and offers Delete in edit mode', () => {
    render(<PersonForm state={{ mode: 'edit', id: 'robert' }} onClose={vi.fn()} />);
    expect(screen.queryByRole('combobox', { name: /relative of/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
  });

  it('never offers Delete for the proband or in add mode', () => {
    const { unmount } = render(
      <PersonForm state={{ mode: 'edit', id: 'you' }} onClose={vi.fn()} />,
    );
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    unmount();

    render(
      <PersonForm state={{ mode: 'add', anchor: 'you', relation: 'child' }} onClose={vi.fn()} />,
    );
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });

  it('prefills edit-mode fields from the existing person', () => {
    render(<PersonForm state={{ mode: 'edit', id: 'robert' }} onClose={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: /^name/i })).toHaveValue('Robert');
    expect(screen.getByRole('button', { name: 'AMAB' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Man' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Living' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('spinbutton', { name: /birth year/i })).toHaveValue(1965);
  });
});

describe('PersonForm — save validation', () => {
  it('disables Save when the name is blank', () => {
    render(
      <PersonForm state={{ mode: 'add', anchor: 'you', relation: 'child' }} onClose={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
  });

  it('disables Save and explains why when the chosen anchor already has two recorded parents', async () => {
    const user = userEvent.setup();
    // Robert already has two parents (frank, marie) in the seed family.
    render(
      <PersonForm state={{ mode: 'add', anchor: 'robert', relation: 'child' }} onClose={vi.fn()} />,
    );
    await user.type(screen.getByRole('textbox', { name: /^name/i }), 'Third Parent');
    await user.selectOptions(screen.getByRole('combobox', { name: /connect as/i }), 'parent');

    expect(screen.getByText(/already has two recorded parents/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
  });
});

describe('PersonForm — editing updates the record', () => {
  it('editing the proband updates name/sab/gender/birth through updatePerson', async () => {
    const user = userEvent.setup();
    render(<PersonForm state={{ mode: 'edit', id: 'you' }} onClose={vi.fn()} />);

    const nameField = screen.getByRole('textbox', { name: /^name/i });
    await user.clear(nameField);
    await user.type(nameField, 'Mayabelle');
    await user.click(screen.getByRole('button', { name: 'AMAB' }));
    await user.click(screen.getByRole('button', { name: 'Man' }));
    const birthField = screen.getByRole('spinbutton', { name: /birth year/i });
    await user.clear(birthField);
    await user.type(birthField, '1990');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    const you = useStore.getState().record.people.find((p) => p.id === 'you')!;
    expect(you.name).toBe('Mayabelle');
    expect(you.sab).toBe('m');
    expect(you.gender).toBe('man');
    expect(you.birth).toBe(1990);
  });

  it('can clear the birth year to unknown rather than snapping to 0', async () => {
    const user = userEvent.setup();
    render(<PersonForm state={{ mode: 'edit', id: 'robert' }} onClose={vi.fn()} />);
    const birthField = screen.getByRole('spinbutton', { name: /birth year/i });
    await user.clear(birthField);
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    expect(useStore.getState().record.people.find((p) => p.id === 'robert')!.birth).toBeNull();
  });

  it('shows the death year field only once Deceased is selected, and Save writes null while Living', async () => {
    const user = userEvent.setup();
    render(<PersonForm state={{ mode: 'edit', id: 'robert' }} onClose={vi.fn()} />);
    expect(screen.queryByRole('spinbutton', { name: /death year/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Deceased' }));
    const deathField = screen.getByRole('spinbutton', { name: /death year/i });
    await user.type(deathField, '2030');

    await user.click(screen.getByRole('button', { name: 'Living' }));
    expect(screen.queryByRole('spinbutton', { name: /death year/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^save$/i }));
    const robert = useStore.getState().record.people.find((p) => p.id === 'robert')!;
    expect(robert.dead).toBe(false);
    expect(robert.death).toBeNull();
  });

  it('resets the organ inventory to the new default on a genuine sex-assigned-at-birth change, but not on a redundant re-click', async () => {
    const user = userEvent.setup();
    render(<PersonForm state={{ mode: 'edit', id: 'you' }} onClose={vi.fn()} />);
    // Maya (AFAB) starts with breasts present — un-toggle it as a manual customisation.
    await user.click(screen.getByRole('button', { name: 'Breasts' }));
    expect(screen.getByRole('button', { name: 'Breasts' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    // Re-clicking the already-selected "Female" must not clobber that customisation.
    await user.click(screen.getByRole('button', { name: 'AFAB' }));
    expect(screen.getByRole('button', { name: 'Breasts' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    // Switching to "Male" re-derives the organ set from the new sab.
    await user.click(screen.getByRole('button', { name: 'AMAB' }));
    expect(screen.getByRole('button', { name: 'Prostate' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Breasts' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('keeps a selected condition, preserving its onset/provenance, while dropping an unselected one', async () => {
    const user = userEvent.setup();
    // Robert starts with cad{60,record}, htn{52,record}, chol{48,record}.
    render(<PersonForm state={{ mode: 'edit', id: 'robert' }} onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /remove hypertension/i }));
    await user.click(screen.getByRole('button', { name: /remove high cholesterol/i }));
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    const robert = useStore.getState().record.people.find((p) => p.id === 'robert')!;
    expect(robert.conds).toEqual([{ id: 'cad', onset: 60, prov: 'record' }]);
  });

  it('adds a condition via the catalog search and includes it on save', async () => {
    const user = userEvent.setup();
    // Alex carries no conditions in the seed.
    render(<PersonForm state={{ mode: 'edit', id: 'alex' }} onClose={vi.fn()} />);

    await user.type(screen.getByRole('textbox', { name: /search conditions to add/i }), 'diabetes');
    await user.click(await screen.findByRole('button', { name: /type 2 diabetes/i }));
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    const alex = useStore.getState().record.people.find((p) => p.id === 'alex')!;
    expect(alex.conds).toEqual([{ id: 't2d', onset: null, prov: 'self' }]);
  });

  it('deletes a non-proband person after confirmation and closes', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onClose = vi.fn();
    render(<PersonForm state={{ mode: 'edit', id: 'leo' }} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: /delete/i }));

    expect(useStore.getState().record.people.some((p) => p.id === 'leo')).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('leaves the person in place when the delete confirmation is dismissed', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const onClose = vi.fn();
    render(<PersonForm state={{ mode: 'edit', id: 'leo' }} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: /delete/i }));

    expect(useStore.getState().record.people.some((p) => p.id === 'leo')).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('PersonForm — adding a relative', () => {
  it('anchors a new person via addRelative, links the union, and selects the new person', async () => {
    const user = userEvent.setup();
    const before = useStore.getState().record.people.length;
    render(
      <PersonForm state={{ mode: 'add', anchor: 'you', relation: 'child' }} onClose={vi.fn()} />,
    );

    await user.type(screen.getByRole('textbox', { name: /^name/i }), 'Newkid');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    const state = useStore.getState();
    expect(state.record.people).toHaveLength(before + 1);
    const child = state.record.people.find((p) => p.name === 'Newkid')!;
    expect(
      state.record.unions.some((u) => u.parents.includes('you') && u.children.includes(child.id)),
    ).toBe(true);
    expect(state.selectedId).toBe(child.id);
  });

  it('re-anchors and re-relates from the selects rather than the opener defaults', async () => {
    const user = userEvent.setup();
    render(
      <PersonForm state={{ mode: 'add', anchor: 'you', relation: 'child' }} onClose={vi.fn()} />,
    );

    await user.selectOptions(screen.getByRole('combobox', { name: /relative of/i }), 'walter');
    await user.selectOptions(screen.getByRole('combobox', { name: /connect as/i }), 'partner');
    await user.type(screen.getByRole('textbox', { name: /^name/i }), 'Walter’s Partner');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    const state = useStore.getState();
    const added = state.record.people.find((p) => p.name === 'Walter’s Partner')!;
    expect(
      state.record.unions.some((u) => u.parents.includes('walter') && u.parents.includes(added.id)),
    ).toBe(true);
  });
});
