import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useStore } from '@/store/useStore';
import { OverviewView } from './OverviewView';
import { PatternsView } from './PatternsView';
import { TimelineView } from './TimelineView';
import { PedigreeView } from './PedigreeView';
import { ReportsView } from './ReportsView';
import { GedcomImport } from '../components/GedcomImport';

// These views are asserted against the example family; the app's real default is empty.
beforeEach(() => useStore.getState().loadSample());
// vitest isn't configured with restoreMocks, so a `vi.spyOn(window, 'confirm')` (several
// PedigreeView tests below) would otherwise leak its call history into later tests —
// spying on an already-spied method returns the *same* mock rather than a fresh one, so
// an unrestored spy's prior `.mock.calls` can make a later `not.toHaveBeenCalled()`
// assertion fail for the wrong reason. Restore everything after every test, file-wide.
afterEach(() => vi.restoreAllMocks());

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

  it('surfaces provenance visibly: a legend and per-flag sourcing summaries (not SR-only)', () => {
    render(<PatternsView />);
    // The provenance key is visible to everyone, not gated behind hover/aria.
    expect(screen.getByText(/clinicians weight family history by its source/i)).toBeInTheDocument();
    // At least one flag carries a visible "Sourcing:" summary line.
    const sourcing = screen.getAllByText(/^Sourcing:/i);
    expect(sourcing.length).toBeGreaterThan(0);
    expect(sourcing[0].className).not.toMatch(/visually-hidden/);
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
    // Nodes are real buttons, so they're natively focusable and operable without a
    // pointer — no tabindex patching needed (that was only necessary for the old SVG <g>).
    expect(within(chart).getByRole('button', { name: /Maya/i })).toBeInTheDocument();
    const robert = within(chart).getByRole('button', { name: /Robert/i });
    expect(robert).toBeInTheDocument();
    expect(robert.tagName).toBe('BUTTON');
  });

  it("names affected nodes with every recorded condition and the first condition's category, not colour alone", () => {
    render(<PedigreeView />);
    // Seed data: Robert has cad, htn, chol (in that order) — all three must be named,
    // not just the first, so a highlight matching on any of them is self-explanatory.
    expect(
      screen.getByRole('button', {
        name: /Robert.*affected: Coronary heart disease \(cardiovascular\), Hypertension, High cholesterol/i,
      }),
    ).toBeInTheDocument();
  });

  it("announces a deceased relative's years and marks the proband as you in the accessible name", () => {
    render(<PedigreeView />);
    // Walter (dead, born 1915, died 1994): deceased status and both years are otherwise
    // only conveyed visually (the diagonal slash glyph plus faint years text).
    expect(
      screen.getByRole('button', { name: /Walter.*died 1994.*born 1915/i }),
    ).toBeInTheDocument();
    // Maya is the proband — the visual "YOU" tag is aria-hidden, so the accessible name
    // has to say it explicitly too (mirrors PersonDrawer's "(you)").
    expect(screen.getByRole('button', { name: /Maya, you,.*born 1988/i })).toBeInTheDocument();
  });

  it('names every condition so a highlight matching a non-first condition is still explained', async () => {
    const user = userEvent.setup();
    render(<PedigreeView />);
    const highlightRow = screen.getByRole('group', { name: /highlight a condition or category/i });
    // Linda's first recorded condition is t2d, not brca — naming only the first would
    // leave no clue why she lit up under a "Breast cancer" highlight.
    const breastCancerChip = within(highlightRow).getByRole('button', { name: /^Breast cancer,/i });
    await user.click(breastCancerChip);

    expect(
      screen.getByRole('button', {
        name: /Linda.*Type 2 diabetes.*Breast cancer.*highlighted/i,
      }),
    ).toBeInTheDocument();
  });

  it('gives a highlight chip an accessible name that separates the condition from its count', () => {
    render(<PedigreeView />);
    const highlightRow = screen.getByRole('group', { name: /highlight a condition or category/i });
    // Seed data: cad (coronary heart disease) affects 4 people (Walter, Frank, Robert, Tom).
    const chip = within(highlightRow).getByRole('button', { name: /coronary heart disease/i });
    expect(chip).toHaveAccessibleName(/Coronary heart disease, 4 people/i);
  });

  it('gives a search result an accessible name that separates the condition from its category', async () => {
    const user = userEvent.setup();
    render(<PedigreeView />);
    const highlightRow = screen.getByRole('group', { name: /highlight a condition or category/i });
    await user.click(within(highlightRow).getByRole('button', { name: /search all conditions/i }));
    await user.type(screen.getByRole('textbox', { name: /search all conditions/i }), 'breast');

    expect(screen.getByRole('button', { name: /Breast cancer, Cancer/i })).toBeInTheDocument();
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

  it('states the clinical boundary', () => {
    render(<PedigreeView />);
    expect(screen.getByText(/not a diagnostic device/i)).toBeInTheDocument();
  });

  it('renders the natural-size canvas in a scrollable region, not scaled to fit', () => {
    render(<PedigreeView />);
    const chart = screen.getByRole('group', { name: /family pedigree chart/i });
    // The old implementation used an <svg width="100%"> with a viewBox, which scales the
    // whole tree down to fit the panel. The canvas is now a plain sized DOM element inside
    // an overflow:auto region — width/height come from computeLayout(), not a viewBox.
    expect(chart.tagName).toBe('DIV');
    expect(chart.parentElement).toHaveClass('pedigree-scroll');
  });

  it('selecting a highlight chip dims non-matching nodes and offers a clear control', async () => {
    const user = userEvent.setup();
    render(<PedigreeView />);
    const highlightRow = screen.getByRole('group', { name: /highlight a condition or category/i });
    // Seed data: coronary heart disease (cad) is the most prevalent condition (Walter,
    // Frank, Robert, Tom), so it's the first chip in Condition mode.
    const chip = within(highlightRow).getByRole('button', { name: /coronary heart disease/i });
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    expect(within(highlightRow).queryByRole('button', { name: /clear/i })).not.toBeInTheDocument();

    await user.click(chip);

    expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(within(highlightRow).getByRole('button', { name: /clear/i })).toBeInTheDocument();
    // Robert has coronary heart disease (matches, fully saturated fill); Helen only has
    // BRCA (doesn't match). Only the coloured glyph fill mutes for a non-match — the
    // wrap itself (and so the name/years/border outside the button) is never dimmed,
    // keeping those at full contrast regardless of highlight state (WCAG 1.4.3).
    const robertBtn = screen.getByRole('button', { name: /Robert/i });
    const helenBtn = screen.getByRole('button', { name: /Helen/i });
    expect(helenBtn.parentElement).not.toHaveStyle({ opacity: '0.28' });
    expect(helenBtn.querySelector('.pedigree-node__fill')).toHaveStyle({ opacity: '0.28' });
    expect(robertBtn.querySelector('.pedigree-node__fill')).toHaveStyle({ opacity: '1' });

    // Clicking the same chip again toggles the highlight back off.
    await user.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    expect(within(highlightRow).queryByRole('button', { name: /clear/i })).not.toBeInTheDocument();
  });

  it('switches to Category mode and highlights by category', async () => {
    const user = userEvent.setup();
    render(<PedigreeView />);
    const highlightRow = screen.getByRole('group', { name: /highlight a condition or category/i });
    const modeToggle = within(highlightRow).getByRole('group', { name: /highlight mode/i });

    await user.click(within(modeToggle).getByRole('button', { name: /^category$/i }));
    expect(within(modeToggle).getByRole('button', { name: /^category$/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    const cardiovascular = within(highlightRow).getByRole('button', { name: /cardiovascular/i });
    await user.click(cardiovascular);
    expect(cardiovascular).toHaveAttribute('aria-pressed', 'true');
    // Robert's first condition (coronary heart disease) is cardiovascular; Helen's (BRCA)
    // is not, so her glyph fill mutes under the category filter too (see the dim-
    // treatment test above for why the assertion targets the fill, not the wrap).
    const helenFill = screen
      .getByRole('button', { name: /Helen/i })
      .querySelector('.pedigree-node__fill');
    expect(helenFill).toHaveStyle({ opacity: '0.28' });
  });

  it('clears a stale highlight and add-relative form across a record swap', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<PedigreeView />); // sample loaded via the outer beforeEach

    const highlightRow = screen.getByRole('group', { name: /highlight a condition or category/i });
    const chip = within(highlightRow).getByRole('button', { name: /coronary heart disease/i });
    await user.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: /reset to empty/i }));
    expect(useStore.getState().record.people).toHaveLength(1);

    // The only way back from the empty state is its own "Load example family" button —
    // exactly the path that used to bypass the state-clearing helper (finding #1).
    await user.click(screen.getByRole('button', { name: /load example family/i }));

    const highlightRowAfter = screen.getByRole('group', {
      name: /highlight a condition or category/i,
    });
    expect(
      within(highlightRowAfter).queryByRole('button', { name: /clear/i }),
    ).not.toBeInTheDocument();
    const chipAfter = within(highlightRowAfter).getByRole('button', {
      name: /coronary heart disease/i,
    });
    expect(chipAfter).toHaveAttribute('aria-pressed', 'false');

    const chart = screen.getByRole('group', { name: /family pedigree chart/i });
    const helenFill = within(chart)
      .getByRole('button', { name: /Helen/i })
      .querySelector('.pedigree-node__fill');
    expect(helenFill).toHaveStyle({ opacity: '1' });
  });
});

describe('PedigreeView — empty record', () => {
  it('shows the empty state with an Add relative affordance and a Load example family button', () => {
    // The app's real default is empty (proband only); loadSample() in the outer
    // beforeEach loaded the example family, so reset back to empty before rendering.
    useStore.getState().resetRecord();
    render(<PedigreeView />);
    expect(screen.getByText(/start your family history/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /\+ add relative/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /load example family/i })).toBeInTheDocument();
    // No tree to highlight yet — the Highlight row only makes sense once there's a family.
    expect(
      screen.queryByRole('group', { name: /highlight a condition or category/i }),
    ).not.toBeInTheDocument();
  });

  it('loads the example family only when the user clicks the button (no auto-load)', async () => {
    const user = userEvent.setup();
    useStore.getState().resetRecord();
    render(<PedigreeView />);
    // Not auto-loaded: still just the proband, and no tree rendered yet.
    expect(screen.queryByRole('group', { name: /family pedigree chart/i })).not.toBeInTheDocument();
    expect(useStore.getState().record.people).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: /load example family/i }));

    expect(useStore.getState().record.people.length).toBeGreaterThan(1);
    expect(useStore.getState().record.people.some((p) => p.name === 'Maya')).toBe(true);
    expect(screen.getByRole('group', { name: /family pedigree chart/i })).toBeInTheDocument();
  });

  it('skips the confirmation when loading the example family over an untouched default record', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    useStore.getState().resetRecord();
    render(<PedigreeView />);

    await user.click(screen.getByRole('button', { name: /load example family/i }));

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(useStore.getState().record.people.some((p) => p.name === 'Maya')).toBe(true);
  });

  it('still confirms before overwriting a single-person record if that person has been edited', async () => {
    const user = userEvent.setup();
    useStore.getState().resetRecord();
    // isPristineRecord has to key off the proband's own fields, not just "how many
    // people are recorded" — a record can stay at exactly one person while no longer
    // being the untouched default, e.g. once the user fills in their own birth year.
    useStore.getState().updatePerson('you', {
      name: 'You',
      sab: 'u',
      gender: 'nb',
      dead: false,
      birth: 1990,
      death: null,
      condIds: [],
    });
    render(<PedigreeView />);
    expect(useStore.getState().record.people).toHaveLength(1);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    await user.click(screen.getByRole('button', { name: /load example family/i }));

    expect(confirmSpy).toHaveBeenCalled();
    // Cancelled — the edited record must survive untouched.
    expect(useStore.getState().record.people).toHaveLength(1);
    expect(useStore.getState().record.people[0].birth).toBe(1990);
  });
});

describe('PedigreeView — GEDCOM import', () => {
  const SAMPLE = `0 HEAD
0 @I1@ INDI
1 NAME Alice /Green/
1 SEX F
1 BIRT
2 DATE 1970
0 @I2@ INDI
1 NAME Bob /Green/
1 SEX M
1 BIRT
2 DATE 2000
0 @F1@ FAM
1 HUSB @I1@
1 CHIL @I2@
0 TRLR
`;
  const gedcomFile = () => new File([SAMPLE], 'family.ged', { type: 'text/plain' });

  it('seeds the pedigree from a GEDCOM file chosen in the empty state', async () => {
    const user = userEvent.setup();
    useStore.getState().resetRecord(); // outer beforeEach loaded the sample; start empty
    render(<PedigreeView />);

    await user.click(screen.getByRole('button', { name: /import gedcom/i }));
    await user.upload(screen.getByLabelText(/gedcom file/i), gedcomFile());

    // The parse summary and proband picker appear once the file is read.
    const picker = await screen.findByRole('combobox', { name: /which of these is you/i });
    expect(picker).toHaveValue('I1'); // defaults to the first individual

    await user.click(screen.getByRole('button', { name: /import family/i }));

    const record = useStore.getState().record;
    expect(record.people.map((p) => p.name).sort()).toEqual(['Alice Green', 'Bob Green']);
    expect(record.probandId).toBe('I1');
    // And the imported people render into the tree.
    expect(screen.getByRole('button', { name: /Alice Green/i })).toBeInTheDocument();
  });

  it('lets the user pick which imported person is the record owner', async () => {
    const user = userEvent.setup();
    useStore.getState().resetRecord();
    render(<PedigreeView />);

    await user.click(screen.getByRole('button', { name: /import gedcom/i }));
    await user.upload(screen.getByLabelText(/gedcom file/i), gedcomFile());
    const picker = await screen.findByRole('combobox', { name: /which of these is you/i });

    await user.selectOptions(picker, 'I2');
    await user.click(screen.getByRole('button', { name: /import family/i }));

    expect(useStore.getState().record.probandId).toBe('I2');
    expect(useStore.getState().record.people.find((p) => p.isProband)!.name).toBe('Bob Green');
  });

  it('confirms before replacing a record that is not the untouched default', async () => {
    const user = userEvent.setup();
    // The outer beforeEach loaded the example family, so the record is not pristine.
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<PedigreeView />);

    await user.click(screen.getByRole('button', { name: /import gedcom/i }));
    await user.upload(screen.getByLabelText(/gedcom file/i), gedcomFile());
    await screen.findByRole('combobox', { name: /which of these is you/i });
    await user.click(screen.getByRole('button', { name: /import family/i }));

    expect(confirmSpy).toHaveBeenCalled();
    // Cancelled — the original seed family survives untouched.
    expect(useStore.getState().record.people.some((p) => p.name === 'Maya')).toBe(true);
  });

  it('the header Import GEDCOM button is a real toggle — a second press closes the panel', async () => {
    const user = userEvent.setup();
    render(<PedigreeView />); // sample family loaded, header cluster visible
    await user.click(screen.getByRole('button', { name: /import gedcom/i }));
    expect(screen.getByLabelText(/gedcom file/i)).toBeInTheDocument();
    // Label swaps to a close affordance while open (aria-expanded is also true).
    await user.click(screen.getByRole('button', { name: /close import/i }));
    expect(screen.queryByLabelText(/gedcom file/i)).not.toBeInTheDocument();
  });

  it('does not steal focus to the heading when switching from Add relative to Import', async () => {
    const user = userEvent.setup();
    render(<PedigreeView />);
    await user.click(screen.getByRole('button', { name: /\+ add relative/i }));
    const importBtn = screen.getByRole('button', { name: /import gedcom/i });
    await user.click(importBtn);
    // Focus stays on the toggle the user just pressed, not yanked to the page heading.
    expect(importBtn).toHaveFocus();
    expect(screen.getByLabelText(/gedcom file/i)).toBeInTheDocument();
  });
});

describe('GedcomImport (accessibility)', () => {
  it('keeps a persistent status region so the async parse summary can be announced', () => {
    render(<GedcomImport onImport={vi.fn()} onCancel={vi.fn()} />);
    // Present from first render (empty), so updating its text on parse is announced —
    // rather than the region being inserted already populated (which SRs may miss).
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('keeps Import family keyboard-discoverable before a file parses (aria-disabled, not disabled)', () => {
    render(<GedcomImport onImport={vi.fn()} onCancel={vi.fn()} />);
    const btn = screen.getByRole('button', { name: /import family/i });
    expect(btn).toBeEnabled(); // still in the tab order
    expect(btn).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('PedigreeView — person add/edit modal', () => {
  it('the header "+ add relative" button opens PersonForm anchored to the proband', async () => {
    const user = userEvent.setup();
    render(<PedigreeView />);

    await user.click(screen.getByRole('button', { name: /\+ add relative/i }));

    const dialog = screen.getByRole('dialog', { name: /add relative/i });
    expect(within(dialog).getByRole('combobox', { name: /relative of/i })).toHaveValue('you');
    expect(within(dialog).getByRole('combobox', { name: /connect as/i })).toHaveValue('child');
  });

  it('Escape closes the add-relative modal and returns focus to the button that opened it', async () => {
    const user = userEvent.setup();
    render(<PedigreeView />);
    const openButton = screen.getByRole('button', { name: /\+ add relative/i });
    await user.click(openButton);
    expect(screen.getByRole('dialog', { name: /add relative/i })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: /add relative/i })).not.toBeInTheDocument();
    expect(openButton).toHaveFocus();
  });

  it('offers the drawer’s Parent quick-add until a person has two recorded parents', async () => {
    const user = userEvent.setup();
    render(<PedigreeView />);

    // Walter (seed) has no recorded parents — quick-add offered.
    await user.click(screen.getByRole('button', { name: /Walter/i }));
    expect(
      within(screen.getByRole('dialog', { name: /Walter/i })).getByRole('button', {
        name: /add parent for walter/i,
      }),
    ).toBeInTheDocument();

    // Give Walter one parent; a person can have two, so the quick-add must remain.
    act(() => {
      useStore.getState().addRelative('walter', 'parent', {
        name: 'Walter Sr',
        sab: 'm',
        gender: 'man',
        dead: false,
        birth: 1890,
        death: null,
        condIds: [],
      });
    });
    expect(
      within(screen.getByRole('dialog', { name: /Walter/i })).getByRole('button', {
        name: /add parent for walter/i,
      }),
    ).toBeInTheDocument();
    await user.click(
      within(screen.getByRole('dialog', { name: /Walter/i })).getByRole('button', {
        name: /^close$/i,
      }),
    );

    // Maya (the proband) already has two recorded parents (Robert, Susan) — no quick-add.
    await user.click(screen.getByRole('button', { name: /^Maya/i }));
    const mayaDrawer = screen.getByRole('dialog', { name: /Maya/i });
    expect(
      within(mayaDrawer).queryByRole('button', { name: /add parent for maya/i }),
    ).not.toBeInTheDocument();
    // Partner/Sibling/Child are always offered, regardless of existing parents.
    expect(
      within(mayaDrawer).getByRole('button', { name: /add partner for maya/i }),
    ).toBeInTheDocument();
  });

  it('drawer "Add connected relative → Child" opens the form anchored correctly, and Save links the child', async () => {
    const user = userEvent.setup();
    render(<PedigreeView />);
    await user.click(screen.getByRole('button', { name: /Robert/i }));
    const drawer = screen.getByRole('dialog', { name: /Robert/i });
    await user.click(within(drawer).getByRole('button', { name: /add child for robert/i }));

    const dialog = screen.getByRole('dialog', { name: /add relative/i });
    expect(within(dialog).getByRole('combobox', { name: /relative of/i })).toHaveValue('robert');
    expect(within(dialog).getByRole('combobox', { name: /connect as/i })).toHaveValue('child');

    const before = useStore.getState().record.people.length;
    await user.type(within(dialog).getByRole('textbox', { name: /^name/i }), 'Robert Junior');
    await user.click(within(dialog).getByRole('button', { name: /^save$/i }));

    const state = useStore.getState();
    expect(state.record.people).toHaveLength(before + 1);
    const child = state.record.people.find((p) => p.name === 'Robert Junior')!;
    expect(
      state.record.unions.some(
        (u) => u.parents.includes('robert') && u.children.includes(child.id),
      ),
    ).toBe(true);
    // The modal closed and the new person is now selected (its drawer replaces Robert's).
    expect(screen.queryByRole('dialog', { name: /add relative/i })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: /Robert Junior/i })).toBeInTheDocument();
  });

  it('drawer "Edit details" opens an edit dialog prefilled for that person, and Save updates the record', async () => {
    const user = userEvent.setup();
    render(<PedigreeView />);
    await user.click(screen.getByRole('button', { name: /Susan/i }));
    const drawer = screen.getByRole('dialog', { name: /Susan/i });
    await user.click(within(drawer).getByRole('button', { name: /edit details for susan/i }));

    const dialog = screen.getByRole('dialog', { name: /edit susan/i });
    expect(within(dialog).getByRole('textbox', { name: /^name/i })).toHaveValue('Susan');

    await user.click(within(dialog).getByRole('button', { name: 'Deceased' }));
    await user.click(within(dialog).getByRole('button', { name: /^save$/i }));

    expect(useStore.getState().record.people.find((p) => p.id === 'susan')!.dead).toBe(true);
  });

  it('Escape over a drawer-launched edit dialog closes only the dialog, leaving the drawer open', async () => {
    const user = userEvent.setup();
    render(<PedigreeView />);
    await user.click(screen.getByRole('button', { name: /Robert/i }));
    // Both dialogs will contain "Robert", so match the drawer by its exact name.
    expect(screen.getByRole('dialog', { name: 'Robert' })).toBeInTheDocument();

    await user.click(
      within(screen.getByRole('dialog', { name: 'Robert' })).getByRole('button', {
        name: /edit details for robert/i,
      }),
    );
    expect(screen.getByRole('dialog', { name: /edit robert/i })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    // The edit modal (topmost layer) closes; Robert's drawer beneath it must stay open —
    // both listen for Escape on document, so the modal's presence has to arbitrate.
    expect(screen.queryByRole('dialog', { name: /edit robert/i })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Robert' })).toBeInTheDocument();
    expect(useStore.getState().selectedId).toBe('robert');
  });

  it('keeps focus on the page (not <body>) after deleting the selected person', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<PedigreeView />);

    // Leo is a leaf relative, so deleting him doesn't empty the tree (the empty-state
    // focus rescue never fires) — this exercises the delete-specific rescue in isolation.
    await user.click(screen.getByRole('button', { name: /Leo/i }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Leo' })).getByRole('button', {
        name: /edit details for leo/i,
      }),
    );
    await user.click(
      within(screen.getByRole('dialog', { name: /edit leo/i })).getByRole('button', {
        name: /^delete$/i,
      }),
    );

    expect(useStore.getState().record.people.some((p) => p.id === 'leo')).toBe(false);
    // Focus must land on the stable page heading, not be dropped to <body>.
    expect(document.body).not.toHaveFocus();
    expect(screen.getByRole('heading', { name: /family pedigree/i })).toHaveFocus();
  });

  it('"Edit your details" from the empty state opens an edit dialog for the proband, and Save updates it', async () => {
    const user = userEvent.setup();
    useStore.getState().resetRecord();
    render(<PedigreeView />);

    await user.click(screen.getByRole('button', { name: /edit your details/i }));
    const dialog = screen.getByRole('dialog', { name: /edit you/i });

    const nameField = within(dialog).getByRole('textbox', { name: /^name/i });
    await user.clear(nameField);
    await user.type(nameField, 'Jordan');
    await user.click(within(dialog).getByRole('button', { name: 'AFAB' }));
    await user.click(within(dialog).getByRole('button', { name: 'Woman' }));
    await user.type(within(dialog).getByRole('spinbutton', { name: /birth year/i }), '1995');
    await user.click(within(dialog).getByRole('button', { name: /^save$/i }));

    const proband = useStore.getState().record.people.find((p) => p.isProband)!;
    expect(proband.name).toBe('Jordan');
    expect(proband.sab).toBe('f');
    expect(proband.gender).toBe('woman');
    expect(proband.birth).toBe(1995);
    // Still the empty state — editing yourself isn't the same as adding a relative.
    expect(screen.getByText(/start your family history/i)).toBeInTheDocument();
  });
});

describe('ReportsView', () => {
  // Downloads route through the Blob/URL/anchor-click trio, none of which jsdom
  // actually performs — stub them so a click is observable without a real navigation.
  let clicks: { href: string; download: string }[];

  beforeEach(() => {
    clicks = [];
    // jsdom doesn't implement these at all (not even as a throwing stub), so they must
    // be assigned outright rather than spied on.
    URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push({ href: this.href, download: this.download });
    });
  });

  it('downloads the GEDCOM export as a blob URL with the expected filename', async () => {
    const user = userEvent.setup();
    render(<ReportsView />);
    const gedcomCard = screen.getByText('GEDCOM').closest('.card') as HTMLElement;
    await user.click(within(gedcomCard).getByRole('button', { name: 'Download' }));

    expect(clicks).toHaveLength(1);
    expect(clicks[0].href).toBe('blob:mock-url');
    expect(clicks[0].download).toBe('stemma-family.ged');
  });

  it('previews the GEDCOM export as text starting with the GEDCOM header', async () => {
    const user = userEvent.setup();
    render(<ReportsView />);
    const gedcomCard = screen.getByText('GEDCOM').closest('.card') as HTMLElement;
    await user.click(within(gedcomCard).getByRole('button', { name: 'Preview' }));

    const pre = document.querySelector('pre');
    expect(pre).toBeTruthy();
    expect(pre!.textContent).toContain('0 HEAD');
  });
});
