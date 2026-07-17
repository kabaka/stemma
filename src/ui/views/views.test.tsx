import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useStore } from '@/store/useStore';
import { useHistoryStore } from '@/store/useHistoryStore';
import type { HistoryEntry } from '@/domain/history';
import type { FamilyRecord, Person, TimelineEvent } from '@/domain/types';
import { emptyRecord } from '@/data/seed';
import { CLINICAL_BOUNDARY_TEXT } from '@/domain/boundary';
import { OverviewView } from './OverviewView';
import { PatternsView } from './PatternsView';
import { TimelineView } from './TimelineView';
import { PedigreeView } from './PedigreeView';
import { ReportsView } from './ReportsView';
import { HistoryView } from './HistoryView';
import { PrintReports } from '../components/PrintReports';
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

  it('states the clinical boundary as a first-class callout (guardrail #3)', () => {
    render(<OverviewView />);
    const boundary = screen.getByRole('note', { name: /clinical boundary/i });
    expect(boundary).toHaveTextContent(/not a diagnostic device/i);
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

  it('shows the proband’s three newest timeline events as recent activity (M1)', () => {
    render(<OverviewView />);
    // Scoped to the "Recent activity" list itself: the HBOC flag's own recommendation text
    // now also legitimately contains "genetic counseling" (the HBOC-pancreatic/male-breast
    // wording added for the audit's clinical-sensitivity extension), so an unscoped
    // `getByText` is ambiguous — the assertion should be about the activity list, not the
    // whole page.
    const list = screen.getByRole('list', { name: /recent activity/i });
    // Maya's three newest events: 2026 Annual physical, 2025 Genetic counseling,
    // 2024 Annual mammogram — all with their year and type label.
    expect(within(list).getByText(/annual physical/i)).toBeInTheDocument();
    expect(within(list).getByText(/genetic counseling/i)).toBeInTheDocument();
    expect(within(list).getByText(/annual mammogram/i)).toBeInTheDocument();
    // Only three; older proband events (and relatives' events) are not in the list.
    expect(within(list).queryByText(/started levothyroxine/i)).not.toBeInTheDocument();
  });

  it('marks recent activity as a real list of three items for assistive tech', () => {
    render(<OverviewView />);
    const list = screen.getByRole('list', { name: /recent activity/i });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
  });

  it('renders an advisory schedule label (never a standalone "Overdue" verdict), plus the family-history caveat when a signal is present (guardrail #2)', () => {
    // Purpose-built fixture (not the seed): a proband with a schedulable screen (breast
    // tissue, well past mammogram's startAge 40, no completion on record — overdue by
    // construction) whose blood parent carries the flagging condition, so the screen also
    // escalates to "Recommended" and the family-history caveat has something to attach to.
    act(() =>
      useStore.getState().replaceRecord({
        people: [
          {
            id: 'parent',
            name: 'Pat',
            sab: 'f',
            gender: 'woman',
            gen: 0,
            x: 0,
            dead: false,
            birth: 1950,
            death: null,
            conds: [{ id: 'brca', onset: 45, prov: 'record' }],
          },
          {
            id: 'you',
            name: 'Robin',
            sab: 'f',
            gender: 'woman',
            gen: 1,
            x: 0,
            dead: false,
            birth: 1980, // age 46 in 2026 — past mammogram's startAge 40, so it schedules.
            death: null,
            isProband: true,
            organs: ['breasts'],
            conds: [],
          },
        ],
        unions: [{ parents: ['parent'], children: ['you'] }],
        timeline: [],
        probandId: 'you',
      }),
    );
    render(<OverviewView />);

    // Advisory phrasing only — "May be due" / "On track" / "Not yet due" — never a bare verdict.
    // (Robin's fixture yields more than one schedulable screen — mammogram and the
    // organ-agnostic lipids/HbA1c cadences all qualify at age 46 — so assert at least one.)
    expect(screen.getAllByText(/may be due|on track|not yet due/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/^overdue$/i)).not.toBeInTheDocument();

    // Pat's BRCA history escalates Robin's mammogram screen — the caveat renders alongside it.
    expect(
      screen.getByText(/family history — guidelines often start earlier/i),
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

  it('renders the clinical boundary as a first-class callout, not lede body text (guardrail #3)', () => {
    render(<PatternsView />);
    const boundary = screen.getByRole('note', { name: /clinical boundary/i });
    expect(boundary).toHaveClass('clinical-boundary');
    expect(boundary).toHaveTextContent(/not a diagnostic device/i);
    expect(boundary).toHaveTextContent(/never manufactures a risk number/i);
  });

  it('keeps the boundary compact: core statement visible, elaboration in a collapsed disclosure (guardrail #3)', () => {
    render(<PatternsView />);
    const boundary = screen.getByRole('note', { name: /clinical boundary/i });
    // The essential statement is always present as chrome, not tucked inside the disclosure.
    expect(boundary).toHaveTextContent(/not a diagnostic device/i);
    // The fuller elaboration lives in a <details> that is collapsed by default (the
    // compactness win) but still in the DOM one interaction away — so the full
    // "never manufactures a risk number" wording is reachable, never deleted.
    const details = boundary.querySelector('details');
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute('open');
    expect(details).toHaveTextContent(/never manufactures a risk number/i);
    // The disclosure is toggled by a real <summary> control.
    expect(
      within(boundary)
        .getByText(/why this matters/i)
        .tagName.toLowerCase(),
    ).toBe('summary');
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

  it('labels the person switcher "Viewing", visibly (no longer an unlabelled control)', () => {
    render(<TimelineView />);
    // Now a real, visible <label> ("Viewing") wraps the select — matching PatternsView's
    // own vantage selector, rather than a visually-hidden label as before.
    expect(screen.getByRole('combobox', { name: /^viewing$/i })).toBeInTheDocument();
  });

  it('edits an existing event in place through updateEvent', async () => {
    const user = userEvent.setup();
    render(<TimelineView />);
    // Open the inline editor for a seed event.
    await user.click(screen.getByRole('button', { name: /edit started levothyroxine/i }));

    const titleField = screen.getByLabelText(/^title$/i) as HTMLInputElement;
    await user.clear(titleField);
    await user.type(titleField, 'Adjusted levothyroxine dose');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(screen.getByText(/adjusted levothyroxine dose/i)).toBeInTheDocument();
    expect(screen.queryByText(/started levothyroxine/i)).not.toBeInTheDocument();
    // Persisted, not just local UI.
    expect(
      useStore.getState().record.timeline.some((e) => e.title === 'Adjusted levothyroxine dose'),
    ).toBe(true);
  });

  it('moves focus into the edit form and marks the Edit trigger as expanded', async () => {
    const user = userEvent.setup();
    render(<TimelineView />);
    const editBtn = screen.getByRole('button', { name: /edit started levothyroxine/i });
    expect(editBtn).toHaveAttribute('aria-expanded', 'false');
    await user.click(editBtn);
    // Focus lands on the form's first field so keyboard/SR users know it opened (WCAG 2.4.3).
    expect(screen.getByLabelText(/^person$/i)).toHaveFocus();
  });

  it('logs a new event to a chosen relative via the person picker', async () => {
    const user = userEvent.setup();
    render(<TimelineView />);
    await user.click(screen.getByRole('button', { name: /log event/i }));

    // The add form exposes a Person picker (not just the currently-viewed person).
    const personPicker = screen.getByRole('combobox', { name: /^person$/i });
    const options = within(personPicker).getAllByRole('option') as HTMLOptionElement[];
    expect(options.length).toBeGreaterThan(1);
    // Attach to some relative other than the proband.
    const relative = options.find((o) => !/\(you\)/i.test(o.textContent ?? ''))!;
    await user.selectOptions(personPicker, relative.value);

    await user.type(screen.getByLabelText(/^title$/i), 'New relative event');
    await user.click(screen.getByRole('button', { name: /save event/i }));

    const saved = useStore.getState().record.timeline.find((e) => e.title === 'New relative event');
    expect(saved).toBeTruthy();
    expect(saved!.person).toBe(relative.value);
  });

  it('shows the "Which screening (optional)" picker only when Type is Screening', async () => {
    const user = userEvent.setup();
    render(<TimelineView />);
    await user.click(screen.getByRole('button', { name: /log event/i }));

    // Default Type is Diagnosis — the screening picker is absent.
    expect(screen.queryByRole('combobox', { name: /which screening/i })).not.toBeInTheDocument();

    const typeSelect = screen.getByRole('combobox', { name: /^type$/i });
    await user.selectOptions(typeSelect, 'screening');
    expect(screen.getByRole('combobox', { name: /which screening/i })).toBeInTheDocument();

    // Switching to any other type hides it again — it's only meaningful for Screening.
    await user.selectOptions(typeSelect, 'visit');
    expect(screen.queryByRole('combobox', { name: /which screening/i })).not.toBeInTheDocument();
  });

  it('clears a previously linked screeningId when the user picks "— none —" and saves (regression)', async () => {
    // Regression for the unlink bug: `updateEvent` partial-merges, so an *omitted*
    // screeningId key used to leave a stale link when the user picked "— none —". The fix
    // sets `screeningId: undefined` explicitly so the merge actually clears it.
    const user = userEvent.setup();
    render(<TimelineView />);
    await user.click(screen.getByRole('button', { name: /log event/i }));
    await user.type(screen.getByLabelText(/^title$/i), 'Linked screening event');
    await user.selectOptions(screen.getByRole('combobox', { name: /^type$/i }), 'screening');
    await user.selectOptions(
      screen.getByRole('combobox', { name: /which screening/i }),
      'mammogram',
    );
    await user.click(screen.getByRole('button', { name: /save event/i }));

    expect(
      useStore.getState().record.timeline.find((e) => e.title === 'Linked screening event')
        ?.screeningId,
    ).toBe('mammogram');

    // Re-open the saved event: the form re-hydrates the picker from the stored link.
    await user.click(screen.getByRole('button', { name: /edit linked screening event/i }));
    const screeningSelect = screen.getByRole('combobox', {
      name: /which screening/i,
    }) as HTMLSelectElement;
    expect(screeningSelect.value).toBe('mammogram');

    await user.selectOptions(screeningSelect, '');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(
      useStore.getState().record.timeline.find((e) => e.title === 'Linked screening event')
        ?.screeningId,
    ).toBeUndefined();
  });

  it('clears a previously linked screeningId when Type is switched away from Screening (regression)', async () => {
    const user = userEvent.setup();
    render(<TimelineView />);
    await user.click(screen.getByRole('button', { name: /log event/i }));
    await user.type(screen.getByLabelText(/^title$/i), 'Retyped screening event');
    await user.selectOptions(screen.getByRole('combobox', { name: /^type$/i }), 'screening');
    await user.selectOptions(
      screen.getByRole('combobox', { name: /which screening/i }),
      'colonoscopy',
    );
    await user.click(screen.getByRole('button', { name: /save event/i }));

    expect(
      useStore.getState().record.timeline.find((e) => e.title === 'Retyped screening event')
        ?.screeningId,
    ).toBe('colonoscopy');

    await user.click(screen.getByRole('button', { name: /edit retyped screening event/i }));
    await user.selectOptions(screen.getByRole('combobox', { name: /^type$/i }), 'visit');
    // The picker itself disappears once Type is no longer Screening.
    expect(screen.queryByRole('combobox', { name: /which screening/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(
      useStore.getState().record.timeline.find((e) => e.title === 'Retyped screening event')
        ?.screeningId,
    ).toBeUndefined();
  });

  it('reveals the medication sub-fields for Type = Medication, hides them for Type = Lab (which reveals its own value/unit/reference-range), and reveals Allergy fields for Type = Allergy', async () => {
    const user = userEvent.setup();
    render(<TimelineView />);
    await user.click(screen.getByRole('button', { name: /log event/i }));
    const typeSelect = screen.getByRole('combobox', { name: /^type$/i });

    // Default Type (Diagnosis) shows none of the structured sub-fieldsets.
    expect(screen.queryByLabelText(/dose/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^value$/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/substance/i)).not.toBeInTheDocument();

    await user.selectOptions(typeSelect, 'medication');
    expect(screen.getByLabelText(/dose/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/ongoing/i)).toBeInTheDocument();

    await user.selectOptions(typeSelect, 'lab');
    // Medication fields are gone once Type is no longer Medication...
    expect(screen.queryByLabelText(/dose/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/ongoing/i)).not.toBeInTheDocument();
    // ...and Lab's own value/unit/reference-range fields are shown instead.
    expect(screen.getByLabelText(/^value$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^unit$/i)).toBeInTheDocument();
    expect(screen.getByText(/reference range/i)).toBeInTheDocument();

    await user.selectOptions(typeSelect, 'allergy');
    expect(screen.queryByLabelText(/^value$/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/substance/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^severity$/i)).toBeInTheDocument();
  });

  it('clears a previously saved medication payload when Type is switched to Lab and saved (regression, mirrors the screeningId-clear fix)', async () => {
    // The same partial-merge hazard that bit screeningId (see the two regression tests
    // above) applies to every type-specific sub-object: switching Type away from
    // Medication must explicitly clear `med`, not just stop rendering its fields.
    const user = userEvent.setup();
    render(<TimelineView />);
    await user.click(screen.getByRole('button', { name: /log event/i }));
    await user.type(screen.getByLabelText(/^title$/i), 'Retyped medication event');
    await user.selectOptions(screen.getByRole('combobox', { name: /^type$/i }), 'medication');
    await user.type(screen.getByLabelText(/dose/i), '10mg daily');
    await user.click(screen.getByRole('button', { name: /save event/i }));

    const saved = useStore
      .getState()
      .record.timeline.find((e) => e.title === 'Retyped medication event');
    expect(saved?.med).toEqual({ dose: '10mg daily', ongoing: true, stopYear: undefined });

    await user.click(screen.getByRole('button', { name: /edit retyped medication event/i }));
    await user.selectOptions(screen.getByRole('combobox', { name: /^type$/i }), 'lab');
    await user.type(screen.getByLabelText(/^value$/i), '100');
    await user.type(screen.getByLabelText(/^unit$/i), 'mg/dL');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    const updated = useStore
      .getState()
      .record.timeline.find((e) => e.title === 'Retyped medication event');
    expect(updated?.med).toBeUndefined();
    expect(updated?.lab).toEqual({
      value: 100,
      unit: 'mg/dL',
      refLow: undefined,
      refHigh: undefined,
    });
  });

  it('renders the "Currently taking" surface with a fixture person\'s ongoing medication', () => {
    act(() =>
      useStore.getState().replaceRecord({
        people: [
          {
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
          },
        ],
        unions: [],
        timeline: [
          {
            id: 'med-1',
            person: 'you',
            year: 2020,
            type: 'medication',
            title: 'Started Metformin',
            detail: '',
            med: { dose: '500mg BID', ongoing: true },
          },
        ],
        probandId: 'you',
      }),
    );
    render(<TimelineView />);
    const meds = screen.getByRole('list', { name: /currently taking/i });
    expect(within(meds).getByText(/started metformin/i)).toBeInTheDocument();
    expect(within(meds).getByText(/500mg BID/i)).toBeInTheDocument();
  });

  it('omits the "Currently taking" list content when no medication is structured/ongoing, and omits the lab-trend surface when no lab title exists', () => {
    // The sample family's medication/lab events are all legacy flat events (no
    // structured payload) — neither read-model surface has anything to key off.
    render(<TimelineView />);
    expect(screen.getByRole('heading', { name: /currently taking/i })).toBeInTheDocument();
    expect(screen.getByText(/no current medications recorded/i)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /lab trend/i })).not.toBeInTheDocument();
  });

  it('renders the lab-trend surface — with the clinical boundary — when a lab title exists for the person', () => {
    act(() =>
      useStore.getState().replaceRecord({
        people: [
          {
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
          },
        ],
        unions: [],
        timeline: [
          {
            id: 'lab-1',
            person: 'you',
            year: 2020,
            type: 'lab',
            title: 'LDL',
            detail: '',
            lab: { value: 130, unit: 'mg/dL', refLow: 0, refHigh: 100 },
          },
        ],
        probandId: 'you',
      }),
    );
    render(<TimelineView />);
    expect(screen.getByRole('heading', { name: /lab trend/i })).toBeInTheDocument();
    expect(screen.getByRole('note', { name: /clinical boundary/i })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /test/i })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '2020' })).toBeInTheDocument();
    expect(screen.getByText(/130 mg\/dL/)).toBeInTheDocument();
  });

  it('NEW-MED-AT-DEFAULT: a brand-new Medication event saved with only a Title (Dose blank, Ongoing left at its default) gets a med payload and appears under "Currently taking" (code-review finding 1)', async () => {
    const user = userEvent.setup();
    render(<TimelineView />);
    await user.click(screen.getByRole('button', { name: /log event/i }));
    await user.selectOptions(screen.getByRole('combobox', { name: /^type$/i }), 'medication');
    // Dose is left blank and "Ongoing" is left at its default (checked) — neither is touched.
    expect((screen.getByLabelText(/ongoing/i) as HTMLInputElement).checked).toBe(true);
    await user.type(screen.getByLabelText(/^title$/i), 'Brand new medication');
    await user.click(screen.getByRole('button', { name: /save event/i }));

    const saved = useStore
      .getState()
      .record.timeline.find((e) => e.title === 'Brand new medication');
    expect(saved?.med).toEqual({ dose: undefined, ongoing: true, stopYear: undefined });

    const meds = screen.getByRole('list', { name: /currently taking/i });
    expect(within(meds).getByText(/brand new medication/i)).toBeInTheDocument();
  });

  it('LEGACY-EDIT-NO-FABRICATION: editing only the title of a legacy medication event (no prior med payload) leaves med undefined and never surfaces it under "Currently taking" (regression)', async () => {
    // The exact bug the unit fixed: the seed's "Started Levothyroxine" (2016) is a
    // type: 'medication' event with no structured `med` payload. Retitling it — without
    // ever touching the medication sub-fields (Dose / Ongoing / Stop year) — used to
    // fabricate `med: { ongoing: true }` on save, which then duplicated the event's title
    // under the new "Currently taking" surface.
    const user = userEvent.setup();
    render(<TimelineView />);
    const before = useStore
      .getState()
      .record.timeline.find((e) => e.title === 'Started Levothyroxine');
    expect(before?.type).toBe('medication');
    expect(before?.med).toBeUndefined();

    await user.click(screen.getByRole('button', { name: /edit started levothyroxine/i }));
    const titleField = screen.getByLabelText(/^title$/i) as HTMLInputElement;
    await user.clear(titleField);
    await user.type(titleField, 'Adjusted levothyroxine dose');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    const updated = useStore
      .getState()
      .record.timeline.find((e) => e.title === 'Adjusted levothyroxine dose');
    expect(updated?.med).toBeUndefined();

    // Renders exactly once (the timeline row) — never duplicated into "Currently taking".
    expect(screen.getAllByText(/adjusted levothyroxine dose/i)).toHaveLength(1);
    expect(screen.queryByRole('list', { name: /currently taking/i })).not.toBeInTheDocument();
    expect(screen.getByText(/no current medications recorded/i)).toBeInTheDocument();
  });

  it('ATTACHMENT-REMOVE-FOCUS: removing an attachment reference moves focus to "+ add reference" (WCAG 2.4.3)', async () => {
    const user = userEvent.setup();
    render(<TimelineView />);
    await user.click(screen.getByRole('button', { name: /log event/i }));
    await user.click(screen.getByRole('button', { name: /add reference/i }));
    expect(screen.getByRole('button', { name: /remove reference 1/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /remove reference 1/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /add reference/i })).toHaveFocus(),
    );
  });

  it('REFERENCE-RANGE-GROUP: the Lab reference-range Low/High inputs are grouped under a named <fieldset> (WCAG 1.3.1)', async () => {
    const user = userEvent.setup();
    render(<TimelineView />);
    await user.click(screen.getByRole('button', { name: /log event/i }));
    await user.selectOptions(screen.getByRole('combobox', { name: /^type$/i }), 'lab');

    const g = screen.getByRole('group', { name: /reference range/i });
    within(g).getByLabelText(/^low$/i);
    within(g).getByLabelText(/^high$/i);
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

  it('names affected nodes with every recorded condition AND every condition’s own category, not colour alone', () => {
    render(<PedigreeView />);
    // Seed data: Robert has cad, htn, chol (in that order) — all three must carry their
    // own category, not just the first, so a highlight matching on any of them is
    // self-explanatory. But all three of Robert's conditions are "Cardiovascular", so this
    // alone couldn't catch a regression that folds in only the FIRST condition's category
    // for every entry (a plausible half-fix) — it would coincidentally render the same
    // string for Robert.
    expect(
      screen.getByRole('button', {
        name: /Robert.*affected: Coronary heart disease \(cardiovascular\), Hypertension \(cardiovascular\), High cholesterol \(cardiovascular\)/i,
      }),
    ).toBeInTheDocument();
    // George (seed) carries t2d then stroke — two DIFFERENT categories (Metabolic &
    // endocrine, then Cardiovascular) — so only a fix that resolves each condition's own
    // category, not the first condition's category reused for every entry, can pass this.
    expect(
      screen.getByRole('button', {
        name: /George.*affected: Type 2 diabetes \(metabolic & endocrine\), Stroke \(cardiovascular\)/i,
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

  it('keeps the full name in the accessible name and a hover title when the visual label truncates', () => {
    // A name wider than the label's max-width (see .pedigree-node__name) truncates visually
    // with an ellipsis — but the full name must still reach assistive tech (via the button's
    // accessible name) and sighted mouse users (via the title tooltip), never lost to CSS.
    const longName = 'Alexandria Constantinides-Okonkwo';
    act(() =>
      useStore.getState().replaceRecord({
        people: [
          {
            id: 'you',
            name: longName,
            sab: 'f',
            gender: 'woman',
            gen: 0,
            x: 0,
            dead: false,
            birth: 1990,
            death: null,
            isProband: true,
            conds: [],
          },
          {
            id: 'kid',
            name: 'Kid',
            sab: 'm',
            gender: 'man',
            gen: 1,
            x: 0,
            dead: false,
            birth: 2015,
            death: null,
            conds: [],
          },
        ],
        unions: [{ parents: ['you'], children: ['kid'] }],
        timeline: [],
        probandId: 'you',
      }),
    );
    render(<PedigreeView />);
    const node = screen.getByRole('button', { name: new RegExp(longName) });
    const nameEl = node.parentElement!.querySelector('.pedigree-node__name');
    expect(nameEl).toHaveAttribute('title', longName);
    expect(nameEl?.textContent).toBe(longName); // text intact; the ellipsis is CSS-only
  });

  it('names every condition so a highlight matching a non-first condition is still explained', async () => {
    const user = userEvent.setup();
    render(<PedigreeView />);
    const highlightRow = screen.getByRole('group', { name: /highlight a condition or category/i });
    await user.click(within(highlightRow).getByRole('button', { name: /^(choose|change)/i }));
    // Linda's first recorded condition is t2d, not brca — naming only the first would
    // leave no clue why she lit up under a "Breast cancer" highlight.
    const breastCancerRow = within(highlightRow).getByRole('button', { name: /^Breast cancer,/i });
    await user.click(breastCancerRow);

    expect(
      screen.getByRole('button', {
        name: /Linda.*Type 2 diabetes.*Breast cancer.*highlighted/i,
      }),
    ).toBeInTheDocument();
  });

  it('gives a highlight row an accessible name that separates the condition, category, and count', async () => {
    const user = userEvent.setup();
    render(<PedigreeView />);
    const highlightRow = screen.getByRole('group', { name: /highlight a condition or category/i });
    await user.click(within(highlightRow).getByRole('button', { name: /^(choose|change)/i }));
    // Seed data: cad (coronary heart disease, category Cardiovascular) affects 4 people
    // (Walter, Frank, Robert, Tom). The row now also visibly states the category (the P0
    // category-label fix), so the accessible name carries all three parts in order.
    const row = within(highlightRow).getByRole('button', { name: /coronary heart disease/i });
    expect(row).toHaveAccessibleName(/Coronary heart disease, Cardiovascular, 4 people/i);
  });

  it('gives a search result an accessible name that separates the condition from its category', async () => {
    const user = userEvent.setup();
    render(<PedigreeView />);
    const highlightRow = screen.getByRole('group', { name: /highlight a condition or category/i });
    // The full-catalog search now lives inside the highlight popover, not behind its own chip.
    await user.click(within(highlightRow).getByRole('button', { name: /^(choose|change)/i }));
    await user.type(screen.getByRole('textbox', { name: /search all conditions/i }), 'breast');

    // Breast cancer is ALSO present in the family (Helen/Linda/Mia), so the "in this family"
    // row now carries the same "Breast cancer, Cancer, N people" accessible name (the P0
    // category-label fix) and would also match an unscoped query — scope to the search
    // results list specifically, since that's what this test is about.
    const dialog = screen.getByRole('dialog', { name: /highlight a condition/i });
    const results = dialog.querySelector('.pedigree-hl-list--results') as HTMLElement;
    expect(
      within(results).getByRole('button', { name: /Breast cancer, Cancer/i }),
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

  it('states the clinical boundary as a first-class callout (guardrail #3)', () => {
    render(<PedigreeView />);
    const boundary = screen.getByRole('note', { name: /clinical boundary/i });
    expect(boundary).toHaveClass('clinical-boundary');
    expect(boundary).toHaveTextContent(/not a diagnostic device/i);
  });

  it('labels generations relative to the proband (YOU / ▲ / ▼), not absolute Gen numbers (M5)', () => {
    render(<PedigreeView />);
    // Maya (proband) is gen 3: her parents' row is one above (▲ 1), grandparents two (▲ 2).
    expect(screen.getByText('▲ 1')).toBeInTheDocument();
    expect(screen.getByText('▲ 2')).toBeInTheDocument();
    // The old absolute "Gen 1/2/3" labels are gone.
    expect(screen.queryByText(/^Gen \d+$/)).not.toBeInTheDocument();
  });

  it('spells out a spotlighted category’s contents as a breakdown string (M2)', async () => {
    const user = userEvent.setup();
    render(<PedigreeView />);
    const highlightRow = screen.getByRole('group', { name: /highlight a condition or category/i });
    await user.click(within(highlightRow).getByRole('button', { name: /^Category$/i }));
    await user.click(within(highlightRow).getByRole('button', { name: /^(choose|change)/i }));
    // Cancer is present in the seed family (e.g. breast cancer), so it has a row.
    await user.click(within(highlightRow).getByRole('button', { name: /^Cancer,/i }));
    // "N people · Breast cancer (2), …" — a headcount, never an "N×" multiplier.
    expect(screen.getByText(/\d+ (person|people) · .*Breast cancer \(\d+\)/i)).toBeInTheDocument();
  });

  it('shows each recorded condition’s inheritance pattern in the drawer (M3)', async () => {
    const user = userEvent.setup();
    render(<PedigreeView />);
    await user.click(screen.getByRole('button', { name: /Maya/i }));
    // Maya carries hypothyroidism; its inheritance pattern value is shown on the card,
    // prefixed with a screen-reader-only label so the bare value has context (WCAG 1.3.1).
    expect(screen.getByText(/autoimmune \/ polygenic/i)).toBeInTheDocument();
    // Each condition card carries the SR-only "Inheritance pattern:" prefix.
    expect(screen.getAllByText(/inheritance pattern:/i).length).toBeGreaterThan(0);
  });

  it('states that screening keys off organs, not gender, in the drawer (guardrail #4)', async () => {
    const user = userEvent.setup();
    render(<PedigreeView />);
    await user.click(screen.getByRole('button', { name: /Maya/i }));
    expect(screen.getByText(/screening keys off organs present, not gender/i)).toBeInTheDocument();
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

  it('selecting a highlight dims non-matching nodes and offers a clear control', async () => {
    const user = userEvent.setup();
    render(<PedigreeView />);
    const highlightRow = screen.getByRole('group', { name: /highlight a condition or category/i });
    // Nothing highlighted yet — no clear control in the header.
    expect(
      within(highlightRow).queryByRole('button', { name: /clear highlight/i }),
    ).not.toBeInTheDocument();

    // Seed data: coronary heart disease (cad) is the most prevalent condition (Walter,
    // Frank, Robert, Tom), so it's the first row in the Condition popover.
    await user.click(within(highlightRow).getByRole('button', { name: /^(choose|change)/i }));
    const cadRow = within(highlightRow).getByRole('button', { name: /coronary heart disease/i });
    expect(cadRow).toHaveAttribute('aria-pressed', 'false');
    await user.click(cadRow); // selects the highlight and closes the popover

    // The header now shows one summary chip that doubles as the clear control.
    const clearBtn = within(highlightRow).getByRole('button', { name: /clear highlight/i });
    expect(clearBtn).toBeInTheDocument();
    // Robert has coronary heart disease (matches, fully saturated fill); Helen only has
    // BRCA (doesn't match). Only the coloured glyph fill mutes for a non-match — the
    // wrap itself (and so the name/years/border outside the button) is never dimmed,
    // keeping those at full contrast regardless of highlight state (WCAG 1.4.3).
    const robertBtn = screen.getByRole('button', { name: /Robert/i });
    const helenBtn = screen.getByRole('button', { name: /Helen/i });
    expect(helenBtn.parentElement).not.toHaveStyle({ opacity: '0.28' });
    expect(helenBtn.querySelector('.pedigree-node__fill')).toHaveStyle({ opacity: '0.28' });
    expect(robertBtn.querySelector('.pedigree-node__fill')).toHaveStyle({ opacity: '1' });

    // Clicking the clear control toggles the highlight back off.
    await user.click(clearBtn);
    expect(
      within(highlightRow).queryByRole('button', { name: /clear highlight/i }),
    ).not.toBeInTheDocument();
    expect(helenBtn.querySelector('.pedigree-node__fill')).toHaveStyle({ opacity: '1' });
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

    await user.click(within(highlightRow).getByRole('button', { name: /^(choose|change)/i }));
    await user.click(within(highlightRow).getByRole('button', { name: /cardiovascular/i }));
    // The header shows the active category as its clear chip.
    expect(
      within(highlightRow).getByRole('button', { name: /clear highlight: cardiovascular/i }),
    ).toBeInTheDocument();
    // Robert's first condition (coronary heart disease) is cardiovascular; Helen's (BRCA)
    // is not, so her glyph fill mutes under the category filter too (see the dim-
    // treatment test above for why the assertion targets the fill, not the wrap).
    const helenFill = screen
      .getByRole('button', { name: /Helen/i })
      .querySelector('.pedigree-node__fill');
    expect(helenFill).toHaveStyle({ opacity: '0.28' });
  });

  it('keeps focus inside the popover when Category mode has no categories to list', async () => {
    const user = userEvent.setup();
    // A family with a relative (so the HighlightBar renders) but no conditions recorded:
    // Category mode's popover then has no rows and no search box, so focus must fall back
    // to the dialog itself — never silently stranded on the trigger.
    act(() =>
      useStore.getState().replaceRecord({
        people: [
          {
            id: 'you',
            name: 'You',
            sab: 'f',
            gender: 'woman',
            gen: 0,
            x: 0,
            dead: false,
            birth: 1990,
            death: null,
            isProband: true,
            conds: [],
          },
          {
            id: 'kid',
            name: 'Kid',
            sab: 'm',
            gender: 'man',
            gen: 1,
            x: 0,
            dead: false,
            birth: 2015,
            death: null,
            conds: [],
          },
        ],
        unions: [{ parents: ['you'], children: ['kid'] }],
        timeline: [],
        probandId: 'you',
      }),
    );
    render(<PedigreeView />);
    const highlightRow = screen.getByRole('group', { name: /highlight a condition or category/i });
    await user.click(within(highlightRow).getByRole('button', { name: /^Category$/i }));
    await user.click(within(highlightRow).getByRole('button', { name: /^(choose|change)/i }));
    const dialog = screen.getByRole('dialog', { name: /highlight a category/i });
    expect(dialog).toHaveTextContent(/no categories recorded yet/i);
    expect(dialog).toHaveFocus();
  });

  it('dismisses the highlight popover when keyboard focus leaves it', async () => {
    const user = userEvent.setup();
    render(<PedigreeView />);
    const highlightRow = screen.getByRole('group', { name: /highlight a condition or category/i });
    await user.click(within(highlightRow).getByRole('button', { name: /^(choose|change)/i }));
    expect(screen.getByRole('dialog', { name: /highlight a condition/i })).toBeInTheDocument();
    // Moving focus out of the popover (a keyboard Tab out to a header control) dismisses it,
    // so a keyboard user is never left with an orphaned dialog floating over the tree.
    // "Reset to empty" now lives inside the collapsed RecordActionsMenu (only rendered once
    // its own trigger is opened), so it isn't a stable always-present target any more —
    // the always-present "More actions" trigger plays the same role here (a header control
    // outside the highlight popover's own subtree).
    act(() => screen.getByRole('button', { name: /more actions/i }).focus());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('clears a stale highlight and add-relative form across a record swap', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<PedigreeView />); // sample loaded via the outer beforeEach

    const highlightRow = screen.getByRole('group', { name: /highlight a condition or category/i });
    await user.click(within(highlightRow).getByRole('button', { name: /^(choose|change)/i }));
    await user.click(within(highlightRow).getByRole('button', { name: /coronary heart disease/i }));
    expect(
      within(highlightRow).getByRole('button', { name: /clear highlight/i }),
    ).toBeInTheDocument();

    // "Reset to empty" now lives inside the collapsed RecordActionsMenu — open it first.
    await user.click(screen.getByRole('button', { name: /more actions/i }));
    await user.click(screen.getByRole('button', { name: /reset to empty/i }));
    expect(useStore.getState().record.people).toHaveLength(1);

    // The only way back from the empty state is its own "Load example family" button —
    // exactly the path that used to bypass the state-clearing helper (finding #1).
    await user.click(screen.getByRole('button', { name: /load example family/i }));

    const highlightRowAfter = screen.getByRole('group', {
      name: /highlight a condition or category/i,
    });
    // The stale highlight is gone: no clear control, and the previously-dimmed node is
    // back to full saturation.
    expect(
      within(highlightRowAfter).queryByRole('button', { name: /clear highlight/i }),
    ).not.toBeInTheDocument();

    const chart = screen.getByRole('group', { name: /family pedigree chart/i });
    const helenFill = within(chart)
      .getByRole('button', { name: /Helen/i })
      .querySelector('.pedigree-node__fill');
    expect(helenFill).toHaveStyle({ opacity: '1' });
  });

  // jsdom reports zero layout everywhere (getBoundingClientRect/clientWidth/clientHeight are
  // always 0) — so the real fit-to-viewport SIZING math (computeFitView) and the off-screen
  // focus-nudge math (nudgeIntoView) can't be meaningfully exercised here; those need a real
  // browser and are covered by the frontend's live `npm run dev` verification. What jsdom CAN
  // exercise faithfully: the zoom-% readout and its clamp (pure state, independent of any
  // measured size), the pan buttons' effect on the canvas's own inline `transform` (string
  // state, not geometry), Reset's return to the known default view, and that Zoom to fit is
  // reachable and doesn't throw. `.pedigree-canvas`'s `transform` is `translate(x, y)
  // scale(s)` (see PedigreeView's `canvasStyle`) — parsed back out below rather than asserted
  // as an opaque string, so the assertions read as "pan step" / "zoom clamp", not string diffs.
  describe('pan / zoom controls', () => {
    const canvas = () => screen.getByRole('group', { name: /family pedigree chart/i });
    const zoomReadout = (): string =>
      document.querySelector('.pedigree-zoom-readout')?.textContent ?? '';
    const parseTransform = (transform: string): { x: number; y: number; scale: number } => {
      const m = transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([-\d.]+)\)/);
      if (!m) throw new Error(`unparseable transform: "${transform}"`);
      return { x: Number(m[1]), y: Number(m[2]), scale: Number(m[3]) };
    };

    it('starts at 100% zoom (the default view)', () => {
      render(<PedigreeView />);
      expect(zoomReadout()).toBe('100%');
      expect(parseTransform(canvas().style.transform).scale).toBe(1);
    });

    it('zoom-out floors the readout at 30% (SCALE_MIN) how ever many times it’s clicked', async () => {
      const user = userEvent.setup();
      render(<PedigreeView />);
      const zoomOut = screen.getByRole('button', { name: /zoom out/i });
      // 1 * (1/1.2)^n <= 0.3 first crosses at n≈7; click well past that to prove it floors
      // rather than continuing to shrink or going negative.
      for (let i = 0; i < 15; i++) await user.click(zoomOut);
      expect(zoomReadout()).toBe('30%');
      expect(parseTransform(canvas().style.transform).scale).toBeCloseTo(0.3, 5);
    });

    it('zoom-in ceils the readout at 150% (SCALE_MAX) how ever many times it’s clicked', async () => {
      const user = userEvent.setup();
      render(<PedigreeView />);
      const zoomIn = screen.getByRole('button', { name: /zoom in/i });
      // 1 * 1.2^n >= 1.5 first crosses at n≈3; click well past that to prove it ceils.
      for (let i = 0; i < 15; i++) await user.click(zoomIn);
      expect(zoomReadout()).toBe('150%');
      expect(parseTransform(canvas().style.transform).scale).toBeCloseTo(1.5, 5);
    });

    it('Reset returns to the default view after panning and zooming away from it', async () => {
      const user = userEvent.setup();
      render(<PedigreeView />);
      const initial = canvas().style.transform;

      await user.click(screen.getByRole('button', { name: /zoom in/i }));
      await user.click(screen.getByRole('button', { name: /pan up/i }));
      expect(canvas().style.transform).not.toBe(initial);

      await user.click(screen.getByRole('button', { name: /^reset$/i }));
      expect(canvas().style.transform).toBe(initial);
      expect(zoomReadout()).toBe('100%');
    });

    it('"Zoom to fit" is present, enabled, and doesn’t throw when activated', async () => {
      const user = userEvent.setup();
      render(<PedigreeView />);
      const fitBtn = screen.getByRole('button', { name: /zoom to fit/i });
      expect(fitBtn).toBeEnabled();
      // With jsdom's zero-size viewport, computeFitView's own fallback keeps this at the
      // default view — real fit-to-content sizing is a browser-only concern (see the
      // describe-level comment above). This only proves the control is reachable/operable.
      await user.click(fitBtn);
      expect(fitBtn).toBeInTheDocument();
    });

    it('each of the four pan buttons shifts the canvas transform by exactly PAN_STEP (60px) on the right axis', async () => {
      const user = userEvent.setup();
      render(<PedigreeView />);
      const PAN_STEP = 60;

      const before1 = parseTransform(canvas().style.transform);
      await user.click(screen.getByRole('button', { name: /pan up/i }));
      const afterUp = parseTransform(canvas().style.transform);
      expect(afterUp.y - before1.y).toBe(PAN_STEP);
      expect(afterUp.x).toBe(before1.x);

      const before2 = parseTransform(canvas().style.transform);
      await user.click(screen.getByRole('button', { name: /pan down/i }));
      const afterDown = parseTransform(canvas().style.transform);
      expect(afterDown.y - before2.y).toBe(-PAN_STEP);
      expect(afterDown.x).toBe(before2.x);

      const before3 = parseTransform(canvas().style.transform);
      await user.click(screen.getByRole('button', { name: /pan left/i }));
      const afterLeft = parseTransform(canvas().style.transform);
      expect(afterLeft.x - before3.x).toBe(PAN_STEP);
      expect(afterLeft.y).toBe(before3.y);

      const before4 = parseTransform(canvas().style.transform);
      await user.click(screen.getByRole('button', { name: /pan right/i }));
      const afterRight = parseTransform(canvas().style.transform);
      expect(afterRight.x - before4.x).toBe(-PAN_STEP);
      expect(afterRight.y).toBe(before4.y);
    });
  });

  it('folds twin/consanguineous-union notation into a node’s accessible name (WCAG 1.1.1)', () => {
    // Father+Mother: a consanguineous union whose two children are ALSO a monozygotic twin
    // set — one fixture exercises both notations. `consanguineousWith` is symmetric (both
    // parents get the note), so it's asserted per-node by name; `twin` notes live on the
    // children.
    act(() =>
      useStore.getState().replaceRecord({
        people: [
          {
            id: 'father',
            name: 'Father',
            sab: 'm',
            gender: 'man',
            gen: 0,
            x: 0,
            dead: false,
            birth: 1950,
            death: null,
            conds: [],
          },
          {
            id: 'mother',
            name: 'Mother',
            sab: 'f',
            gender: 'woman',
            gen: 0,
            x: 100,
            dead: false,
            birth: 1952,
            death: null,
            conds: [],
          },
          {
            id: 'twin1',
            name: 'Twin1',
            sab: 'f',
            gender: 'woman',
            gen: 1,
            x: 0,
            dead: false,
            birth: 1980,
            death: null,
            isProband: true,
            conds: [],
          },
          {
            id: 'twin2',
            name: 'Twin2',
            sab: 'f',
            gender: 'woman',
            gen: 1,
            x: 100,
            dead: false,
            birth: 1980,
            death: null,
            conds: [],
          },
        ],
        unions: [
          {
            parents: ['father', 'mother'],
            children: ['twin1', 'twin2'],
            consanguineous: true,
            twins: [{ members: ['twin1', 'twin2'], zygosity: 'mono' }],
          },
        ],
        timeline: [],
        probandId: 'twin1',
      }),
    );
    render(<PedigreeView />);

    // Both parents of the consanguineous union carry the note (symmetric).
    expect(screen.getAllByRole('button', { name: /consanguineous union with/i })).toHaveLength(2);
    expect(
      screen.getByRole('button', { name: /Father.*consanguineous union with Mother/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Mother.*consanguineous union with Father/i }),
    ).toBeInTheDocument();

    // Both twins carry the monozygotic ("identical") note, naming their co-twin.
    expect(
      screen.getByRole('button', { name: /Twin1.*twin \(identical\) with Twin2/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Twin2.*twin \(identical\) with Twin1/i }),
    ).toBeInTheDocument();
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

    // Import GEDCOM now lives inside the header's collapsed RecordActionsMenu (non-empty
    // record) — open it first.
    await user.click(screen.getByRole('button', { name: /more actions/i }));
    await user.click(screen.getByRole('button', { name: /^import gedcom$/i }));
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
    // Import GEDCOM now lives inside the header's collapsed RecordActionsMenu — the menu
    // itself closes (returning focus to its own trigger) every time one of its own items is
    // clicked, so re-open it before the second press too.
    await user.click(screen.getByRole('button', { name: /more actions/i }));
    await user.click(screen.getByRole('button', { name: /^import gedcom$/i }));
    expect(screen.getByLabelText(/gedcom file/i)).toBeInTheDocument();

    // Label swaps to a close affordance while open (aria-expanded is also true).
    await user.click(screen.getByRole('button', { name: /more actions/i }));
    await user.click(screen.getByRole('button', { name: /close import/i }));
    expect(screen.queryByLabelText(/gedcom file/i)).not.toBeInTheDocument();
  });

  it('does not steal focus to the heading when switching from Add relative to Import', async () => {
    const user = userEvent.setup();
    render(<PedigreeView />);
    await user.click(screen.getByRole('button', { name: /\+ add relative/i }));
    // Import GEDCOM now lives inside the header's collapsed RecordActionsMenu; selecting it
    // closes the menu and returns focus to its own trigger (the same "focus the fallback,
    // then change state" discipline the menu uses throughout) — a header control, not the
    // toggle item itself, but still never the page heading.
    const moreActions = screen.getByRole('button', { name: /more actions/i });
    await user.click(moreActions);
    await user.click(screen.getByRole('button', { name: /^import gedcom$/i }));
    expect(moreActions).toHaveFocus();
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
    // Export buttons carry a per-card accessible name (a11y 2.4.6) rather than the bare
    // "Download"/"Preview" text, so five identical-looking buttons are distinguishable to
    // a screen-reader user tabbing straight to one.
    await user.click(within(gedcomCard).getByRole('button', { name: 'Download GEDCOM' }));

    expect(clicks).toHaveLength(1);
    expect(clicks[0].href).toBe('blob:mock-url');
    expect(clicks[0].download).toBe('stemma-family.ged');
  });

  it('previews the GEDCOM export as text starting with the GEDCOM header', async () => {
    const user = userEvent.setup();
    render(<ReportsView />);
    const gedcomCard = screen.getByText('GEDCOM').closest('.card') as HTMLElement;
    await user.click(within(gedcomCard).getByRole('button', { name: 'Preview GEDCOM' }));

    const pre = document.querySelector('pre');
    expect(pre).toBeTruthy();
    expect(pre!.textContent).toContain('0 HEAD');
  });

  it('renders the pedigree SVG preview inline via dangerouslySetInnerHTML, not as <pre>-wrapped text', async () => {
    const user = userEvent.setup();
    const { container } = render(<ReportsView />);
    const svgCard = screen.getByText('Pedigree chart').closest('.card') as HTMLElement;
    await user.click(within(svgCard).getByRole('button', { name: 'Preview Pedigree chart' }));

    // Unlike the FHIR/Phenopacket/GEDCOM previews (plain text in a <pre>), the SVG format
    // takes the dangerouslySetInnerHTML branch — a real <svg> element must land in the DOM.
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg!.outerHTML).toContain('<circle'); // the seed family has gender-woman nodes
  });

  it('renders the Screening calendar card with a specific accessible name and the vantage note', () => {
    render(<ReportsView />);
    const icsCard = screen.getByText('Screening calendar').closest('.card') as HTMLElement;
    expect(
      within(icsCard).getByRole('button', { name: 'Download Screening calendar' }),
    ).toBeInTheDocument();
    expect(
      within(icsCard).getByRole('button', { name: 'Preview Screening calendar' }),
    ).toBeInTheDocument();
    // Unlike the whole-graph exports above, .ics is scoped to one person — the card says
    // whose calendar this is (the current risk vantage, Maya in the loaded sample).
    expect(within(icsCard).getByText(/^For Maya/)).toBeInTheDocument();
  });

  it('previews the .ics export as VCALENDAR text in a <pre>, not the SVG dangerouslySetInnerHTML branch', async () => {
    const user = userEvent.setup();
    const { container } = render(<ReportsView />);
    const icsCard = screen.getByText('Screening calendar').closest('.card') as HTMLElement;
    await user.click(within(icsCard).getByRole('button', { name: 'Preview Screening calendar' }));

    const pre = document.querySelector('pre');
    expect(pre).toBeTruthy();
    expect(pre!.textContent).toContain('BEGIN:VCALENDAR');
    // Confirm this took the <pre> branch, not the SVG dangerouslySetInnerHTML one.
    expect(container.querySelector('svg')).toBeNull();
  });

  it('downloads a lossless native backup as JSON (H2)', async () => {
    const user = userEvent.setup();
    render(<ReportsView />);
    await user.click(screen.getByRole('button', { name: /download backup/i }));

    expect(clicks).toHaveLength(1);
    expect(clicks[0].download).toBe('stemma-backup.json');
  });

  it('reveals the restore panel on demand and focuses its file input (H2)', async () => {
    const user = userEvent.setup();
    render(<ReportsView />);
    expect(screen.queryByLabelText(/stemma backup file/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /restore from backup/i }));
    const fileInput = screen.getByLabelText(/stemma backup file/i);
    expect(fileInput).toBeInTheDocument();
    // Focus is moved into the panel on open (WCAG 2.4.3).
    expect(fileInput).toHaveFocus();
  });

  it('exposes the backup card title as a navigable heading', () => {
    render(<ReportsView />);
    expect(screen.getByRole('heading', { name: /full-record backup/i })).toBeInTheDocument();
  });
});

describe('PrintReports', () => {
  it('renders three clinical sheets, plus a single running clinical-boundary footer (H1, guardrail #3)', () => {
    const { container } = render(<PrintReports />);
    // The three one-pagers.
    expect(screen.getByRole('heading', { name: /family pedigree/i })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /family-history red-flag summary/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /personal health summary/i })).toBeInTheDocument();
    // Still three distinct printed sheets.
    expect(container.querySelectorAll('.print-sheet')).toHaveLength(3);
    // The clinical boundary is now a single running page footer (fixed, repeated by the
    // browser on every physical printed page) rather than one block per sheet — but it must
    // still be present as a first-class element carrying the canonical wording, not folded
    // away or dropped. Exactly one such footer exists in the document.
    const footers = screen.getAllByRole('note');
    expect(footers).toHaveLength(1);
    expect(footers[0]).toHaveClass('print-footer');
    expect(footers[0]).toHaveTextContent(CLINICAL_BOUNDARY_TEXT);
    // Guard against a regression back to per-sheet duplication or silent removal: the
    // boundary's distinctive "not a diagnostic device" phrase appears exactly once.
    expect(screen.getAllByText(/not a diagnostic device/i)).toHaveLength(1);
  });

  it('restores the organ-vs-gender screening guardrail copy (#4)', () => {
    render(<PrintReports />);
    expect(screen.getByText(/screening keys off organs present, not gender/i)).toBeInTheDocument();
  });

  it('keys Sheet 1’s pedigree legend off gender identity, not sex assigned at birth (regression)', () => {
    const { container } = render(<PrintReports />);
    // Sheet 1 is the family pedigree; its .print-note is the shape-key legend (Sheet 3 also
    // has a .print-note — the organ-vs-gender copy above — so scope to the first sheet).
    const sheet1 = container.querySelectorAll('.print-sheet')[0];
    const legend = sheet1.querySelector('.print-note');
    expect(legend).not.toBeNull();
    const legendText = legend!.textContent!.toLowerCase();
    // Corrected wording: shape is keyed off gender identity (2022 NSGC gender-inclusive
    // notation), with sex-assigned-at-birth noted beneath the glyph only when it differs.
    expect(legendText).toContain('circle = woman');
    expect(legendText).toContain('square = man');
    expect(legendText).toContain('diamond = nonbinary');
    expect(legendText).toContain('sex assigned at birth');
    // Guard against regressing to the old, factually-wrong sex-based phrasing that
    // described shape by sex-assigned-at-birth and mislabeled the diamond as "unknown".
    expect(legendText).not.toContain('assigned male at birth');
    expect(legendText).not.toContain('assigned female');
    expect(legendText).not.toContain('diamond = unknown');
    // The shape-legend copy itself now spells out all three sab labels, including UAAB.
    expect(legend!.textContent).toContain('AFAB/AMAB/UAAB');
  });

  it('renders a category colour key on Sheet 1 listing the categories present in the pedigree window, each with a swatch', () => {
    const { container } = render(<PrintReports />);
    const sheet1 = container.querySelectorAll('.print-sheet')[0];
    const key = sheet1.querySelector('.print-catkey');
    expect(key).not.toBeNull();
    const items = within(key as HTMLElement).getAllByRole('listitem');
    expect(items.length).toBeGreaterThan(0);
    // Every entry carries a visible swatch alongside its text label (never colour alone).
    for (const item of items) {
      expect(item.querySelector('.print-catkey__swatch')).not.toBeNull();
    }
    // The loadSample seed family carries cardiovascular and cancer diagnoses within the
    // proband's four-generation print window — both categories' labels must appear.
    const labels = items.map((i) => i.textContent);
    expect(labels.some((t) => t?.includes('Cardiovascular'))).toBe(true);
    expect(labels.some((t) => t?.includes('Cancer'))).toBe(true);
  });

  it('roots the printed document with a single h1 so the outline is well-formed', () => {
    render(<PrintReports />);
    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveAccessibleName(/stemma clinical print reports/i);
  });

  // ---------------------------------------------------------------------------
  // Sheet 3's three new tables (code review: the loadSample seed carries no structured
  // med/allergy/immunization payloads, so currentMedications()/allergies()/immunizations()
  // all return [] against it and these tables never render under the outer beforeEach's
  // loadSample() fixture — build a proband with real payload events instead.)
  // ---------------------------------------------------------------------------

  function mkProband(overrides: Partial<Person> = {}): Person {
    return {
      id: 'proband',
      name: 'Proband',
      sab: 'f',
      gender: 'woman',
      gen: 0,
      x: 0,
      dead: false,
      birth: 1980,
      death: null,
      conds: [],
      isProband: true,
      ...overrides,
    };
  }

  /** A single proband carrying one event of each new structured-payload type. Years are
   * fixed, safely-past values (never the wall clock) — `currentMedications` only filters
   * on `asOfYear`, which the app derives from `CURRENT_YEAR`, so 2020 is `<=` it either way. */
  function recordWithHealthPayloads(): FamilyRecord {
    const proband = mkProband();
    const timeline: TimelineEvent[] = [
      {
        id: 'med1',
        person: proband.id,
        year: 2020,
        type: 'medication',
        title: 'Started Metformin',
        detail: '',
        med: { dose: '10mg daily', ongoing: true },
      },
      {
        id: 'all1',
        person: proband.id,
        year: 2015,
        type: 'allergy',
        title: 'Penicillin allergy',
        detail: '',
        allergy: { substance: 'Penicillin', reaction: 'Hives', severity: 'moderate' },
      },
      {
        id: 'imm1',
        person: proband.id,
        year: 2019,
        type: 'immunization',
        title: 'Flu shot',
        detail: '',
        immunization: { vaccine: 'Influenza', doseLabel: 'Annual' },
      },
    ];
    return { people: [proband], unions: [], timeline, probandId: proband.id };
  }

  it('renders the Current medications, Allergies & intolerances, and Immunizations tables with correct content', () => {
    act(() => useStore.getState().replaceRecord(recordWithHealthPayloads()));
    render(<PrintReports />);

    const medsHeading = screen.getByRole('heading', { name: 'Current medications', level: 3 });
    const medsTable = medsHeading.nextElementSibling as HTMLElement;
    expect(within(medsTable).getByRole('columnheader', { name: 'Medication' })).toBeInTheDocument();
    expect(within(medsTable).getByRole('columnheader', { name: 'Dose' })).toBeInTheDocument();
    expect(within(medsTable).getByRole('columnheader', { name: 'Since' })).toBeInTheDocument();
    expect(within(medsTable).getByText('Started Metformin')).toBeInTheDocument();
    expect(within(medsTable).getByText('10mg daily')).toBeInTheDocument();
    expect(within(medsTable).getByText('2020')).toBeInTheDocument();

    const allergyHeading = screen.getByRole('heading', {
      name: 'Allergies & intolerances',
      level: 3,
    });
    const allergyTable = allergyHeading.nextElementSibling as HTMLElement;
    expect(
      within(allergyTable).getByRole('columnheader', { name: 'Substance' }),
    ).toBeInTheDocument();
    expect(
      within(allergyTable).getByRole('columnheader', { name: 'Reaction' }),
    ).toBeInTheDocument();
    expect(
      within(allergyTable).getByRole('columnheader', { name: 'Severity' }),
    ).toBeInTheDocument();
    expect(within(allergyTable).getByText('Penicillin')).toBeInTheDocument();
    expect(within(allergyTable).getByText('Hives')).toBeInTheDocument();
    expect(within(allergyTable).getByText('moderate')).toBeInTheDocument();

    const immHeading = screen.getByRole('heading', { name: 'Immunizations', level: 3 });
    const immTable = immHeading.nextElementSibling as HTMLElement;
    expect(
      within(immTable).getByRole('columnheader', { name: 'Immunization' }),
    ).toBeInTheDocument();
    expect(within(immTable).getByRole('columnheader', { name: 'Dose' })).toBeInTheDocument();
    expect(within(immTable).getByRole('columnheader', { name: 'Year' })).toBeInTheDocument();
    expect(within(immTable).getByText('Influenza')).toBeInTheDocument();
    expect(within(immTable).getByText('Annual')).toBeInTheDocument();
    expect(within(immTable).getByText('2019')).toBeInTheDocument();
  });

  it('orders Sheet 3: organ inventory → Conditions → Allergies → Current medications → Immunizations → Recommended screening → Health timeline', () => {
    act(() => useStore.getState().replaceRecord(recordWithHealthPayloads()));
    render(<PrintReports />);
    const sheet3 = screen
      .getByRole('heading', { name: /personal health summary/i })
      .closest('.print-sheet') as HTMLElement;
    const headings = Array.from(sheet3.querySelectorAll('.print-subhead')).map(
      (h) => h.textContent,
    );
    expect(headings).toEqual([
      'Screening-relevant organ inventory',
      'Conditions',
      'Allergies & intolerances',
      'Current medications',
      'Immunizations',
      'Recommended screening',
      'Health timeline',
    ]);
  });

  it('omits the Current medications, Allergies & intolerances, and Immunizations headings when the proband has no structured payload events', () => {
    const proband = mkProband();
    const record: FamilyRecord = {
      people: [proband],
      unions: [],
      timeline: [],
      probandId: proband.id,
    };
    act(() => useStore.getState().replaceRecord(record));
    render(<PrintReports />);

    expect(
      screen.queryByRole('heading', { name: 'Current medications', level: 3 }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Allergies & intolerances', level: 3 }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Immunizations', level: 3 }),
    ).not.toBeInTheDocument();
    // These two headings are unconditional (they render an empty-state message rather
    // than disappearing), so this fixture's absence of the other three isn't just an
    // empty record with nothing rendering at all.
    expect(
      screen.getByRole('heading', { name: 'Screening-relevant organ inventory', level: 3 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Conditions', level: 3 })).toBeInTheDocument();
  });

  /** A proband diagnosed with breast cancer, plus four affected siblings sharing a
   * cardiovascular condition — degree-1 relatives via a shared parental union — so
   * Sheet 2's per-condition "who has it" sub-line has both a proband-diagnosed row
   * (must show "You") and a >3-affected row (must cap at 3 with a "+N more" tail). */
  function recordWithManyAffected(): FamilyRecord {
    const proband = mkProband({ conds: [{ id: 'brca', onset: 41, prov: 'self' }] });
    const mkSib = (id: string, onset: number): Person => ({
      id,
      name: id,
      sab: 'u',
      gender: 'nb',
      gen: 0,
      x: 0,
      dead: false,
      birth: 1980,
      death: null,
      conds: [{ id: 'cad', onset, prov: 'self' }],
    });
    const parent = (id: string): Person => ({
      id,
      name: id,
      sab: 'u',
      gender: 'nb',
      gen: -1,
      x: 0,
      dead: false,
      birth: 1950,
      death: null,
      conds: [],
    });
    const sibs = [mkSib('sib1', 50), mkSib('sib2', 55), mkSib('sib3', 60), mkSib('sib4', 65)];
    return {
      people: [proband, parent('mom'), parent('dad'), ...sibs],
      unions: [{ parents: ['mom', 'dad'], children: [proband.id, ...sibs.map((s) => s.id)] }],
      timeline: [],
      probandId: proband.id,
    };
  }

  it('renders a capped, closest-first "who has it" sub-line under each condition on Sheet 2', () => {
    act(() => useStore.getState().replaceRecord(recordWithManyAffected()));
    render(<PrintReports />);

    const findingsTable = screen.getByRole('heading', { name: 'Conditions in the family' })
      .nextElementSibling as HTMLElement;

    const brcaCell = within(findingsTable).getByText('Breast cancer').closest('td') as HTMLElement;
    const brcaAffected = brcaCell.querySelector('.print-affected');
    expect(brcaAffected).not.toBeNull();
    // The proband is diagnosed — the sub-line must show "You" with her own onset.
    expect(brcaAffected!.textContent).toContain('You (onset 41)');

    const cadCell = within(findingsTable)
      .getByText('Coronary heart disease')
      .closest('td') as HTMLElement;
    const cadAffected = cadCell.querySelector('.print-affected') as HTMLElement;
    expect(cadAffected).not.toBeNull();
    // Four siblings are affected but the line is capped at 3 entries plus a "+1 more" tail.
    expect(cadAffected.textContent).toMatch(/\+1 more/);
    const shownCount = (cadAffected.textContent!.match(/Sibling/g) ?? []).length;
    expect(shownCount).toBe(3);
  });
});

describe('HistoryView', () => {
  /** A copy of the empty record with the proband renamed — enough to give diffRecords a
   * single, unambiguous field-level change to report. */
  const renamedRecord = (name: string): FamilyRecord => {
    const r = emptyRecord();
    r.people = [{ ...r.people[0], name }];
    return r;
  };

  // The outer file-wide `beforeEach(() => useStore.getState().loadSample())` is itself a
  // history-worthy commit (it pushes a real "Loaded sample family" entry with a real
  // Date.now() timestamp) — clear it and seed each test with its own fixed, deterministic
  // entries (fixed `ts` numbers, never the wall clock) so these assertions never depend on
  // when the suite happens to run.
  beforeEach(() => useHistoryStore.setState({ entries: [] }));

  it('renders the empty state when no history has been recorded', () => {
    render(<HistoryView />);
    expect(screen.getByText(/no changes recorded yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: /edit history/i })).not.toBeInTheDocument();
  });

  it('renders entries reverse-chronological — newest first', () => {
    const entries: HistoryEntry[] = [
      { id: 'h1', ts: 1000, label: 'Loaded sample family', record: emptyRecord() },
      { id: 'h2', ts: 2000, label: 'Edited: Renamed', record: renamedRecord('Renamed') },
      { id: 'h3', ts: 3000, label: 'Deleted event', record: renamedRecord('Renamed') },
    ];
    useHistoryStore.setState({ entries });
    render(<HistoryView />);

    const list = screen.getByRole('list', { name: /edit history, newest first/i });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    // Newest push (h3, ts 3000) renders first; oldest (h1, ts 1000) renders last.
    expect(rows[0]).toHaveTextContent(/deleted event/i);
    expect(rows[1]).toHaveTextContent(/edited: renamed/i);
    expect(rows[2]).toHaveTextContent(/loaded sample family/i);
  });

  it('expanding an entry computes and shows its "what changed" diff against the entry before it', async () => {
    const user = userEvent.setup();
    const entries: HistoryEntry[] = [
      { id: 'h1', ts: 1000, label: 'Loaded sample family', record: emptyRecord() },
      { id: 'h2', ts: 2000, label: 'Edited: Renamed', record: renamedRecord('Renamed') },
    ];
    useHistoryStore.setState({ entries });
    render(<HistoryView />);

    await user.click(screen.getByText('Edited: Renamed'));

    // diffRecords(h1.record, h2.record) is a single proband name change ("You" → "Renamed");
    // summarizeDiff renders it as "Edited <after-name>: name" — the diff bullet text this
    // view is responsible for surfacing.
    const diffList = screen.getByRole('list', { name: /what changed/i });
    expect(within(diffList).getByText(/edited renamed: name/i)).toBeInTheDocument();
  });

  it('shows the "oldest change" message for the earliest retained entry (no predecessor to diff against)', async () => {
    const user = userEvent.setup();
    useHistoryStore.setState({
      entries: [{ id: 'h1', ts: 1000, label: 'Loaded sample family', record: emptyRecord() }],
    });
    render(<HistoryView />);

    await user.click(screen.getByText('Loaded sample family'));

    expect(
      screen.getByText(/diff unavailable — this is the oldest change stemma retained/i),
    ).toBeInTheDocument();
    // No diff list is rendered — there is nothing to diff the oldest retained entry against.
    expect(screen.queryByRole('list', { name: /what changed/i })).not.toBeInTheDocument();
  });

  it('renders no ClinicalBoundary — this is a mechanical edit log, not a clinical-analysis surface', () => {
    useHistoryStore.setState({
      entries: [{ id: 'h1', ts: 1000, label: 'Loaded sample family', record: emptyRecord() }],
    });
    render(<HistoryView />);
    expect(screen.queryByRole('note', { name: /clinical boundary/i })).not.toBeInTheDocument();
  });

  it('Clear history moves focus to the page heading and announces the empty state via a status region (accessibility finding)', async () => {
    // "Clear history" only renders while entries.length > 0, so it unmounts itself the
    // moment it's activated — without an explicit focus target, keyboard/AT focus would
    // silently drop to <body> (WCAG 2.4.3), and the empty-state message needs a live
    // region so it's announced rather than only focused (WCAG 4.1.3).
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    useHistoryStore.setState({
      entries: [{ id: 'h1', ts: 1000, label: 'Loaded sample family', record: emptyRecord() }],
    });
    render(<HistoryView />);

    await user.click(screen.getByRole('button', { name: /clear history/i }));

    expect(useHistoryStore.getState().entries).toEqual([]);
    expect(document.activeElement).not.toBe(document.body);
    expect(screen.getByRole('heading', { name: /^history$/i, level: 1 })).toHaveFocus();

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(/no changes recorded yet/i);
  });
});
