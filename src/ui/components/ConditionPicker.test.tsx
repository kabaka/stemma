import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useStore } from '@/store/useStore';
import { ConditionPicker } from './ConditionPicker';
import { defaultVocabularyProvider } from '@/integrations/vocabulary';

// Only the network-touching search() is mocked — hitToCondition (a pure mapping
// function, not I/O) stays the real implementation, per "mock only the network".
vi.mock('@/integrations/vocabulary', async () => {
  const actual = await vi.importActual<typeof import('@/integrations/vocabulary')>(
    '@/integrations/vocabulary',
  );
  return {
    ...actual,
    defaultVocabularyProvider: { ...actual.defaultVocabularyProvider, search: vi.fn() },
  };
});

const searchMock = vi.mocked(defaultVocabularyProvider.search);

beforeEach(() => {
  useStore.getState().loadSample(); // tests attach conditions to example-family members
  searchMock.mockReset();
});

describe('ConditionPicker — ICD-10-CM vocabulary flow', () => {
  it('registers the extension and attaches the code when a vocabulary hit is picked', async () => {
    const user = userEvent.setup();
    searchMock.mockResolvedValueOnce([
      { code: 'C50.911', name: 'Malignant neoplasm of right female breast', system: 'ICD-10-CM' },
    ]);
    // Alex carries no conditions in the seed, so his "no conditions" state is the start point.
    render(<ConditionPicker personId="alex" />);

    await user.type(screen.getByLabelText(/search conditions/i), 'zzznotarealcondition');
    await user.click(screen.getByRole('button', { name: /search all icd-10-cm/i }));

    const hit = await screen.findByRole('button', {
      name: /malignant neoplasm of right female breast/i,
    });
    await user.click(hit);

    expect(useStore.getState().extensions.some((c) => c.id === 'C50.911')).toBe(true);
    const alex = useStore.getState().record.people.find((p) => p.id === 'alex')!;
    expect(alex.conds.some((c) => c.id === 'C50.911')).toBe(true);
  });

  it('shows an error message when the lookup fails', async () => {
    const user = userEvent.setup();
    searchMock.mockRejectedValueOnce(new Error('network down'));
    render(<ConditionPicker personId="alex" />);

    await user.type(screen.getByLabelText(/search conditions/i), 'zzznotarealcondition');
    await user.click(screen.getByRole('button', { name: /search all icd-10-cm/i }));

    expect(await screen.findByText(/lookup failed/i)).toBeInTheDocument();
  });

  it('shows a no-matches message for an empty result set', async () => {
    const user = userEvent.setup();
    searchMock.mockResolvedValueOnce([]);
    render(<ConditionPicker personId="alex" />);

    await user.type(screen.getByLabelText(/search conditions/i), 'zzznotarealcondition');
    await user.click(screen.getByRole('button', { name: /search all icd-10-cm/i }));

    expect(await screen.findByText(/no icd-10-cm matches/i)).toBeInTheDocument();
  });
});

describe('ConditionPicker — exact onset date entry (W6)', () => {
  // Robert carries "Coronary heart disease" (cad) and "Hypertension" (htn) in the seed —
  // two rows, so per-row scoping (not a bare screen.getByRole) is required throughout.
  const cadCard = (): HTMLElement =>
    screen.getByText('Coronary heart disease').closest('.card') as HTMLElement;

  it('leaves onsetDate undefined until the refinement is used — independent of the onset age field', () => {
    render(<ConditionPicker personId="robert" />);
    const card = cadCard();
    expect(within(card).getByRole('button', { name: /add exact onset date/i })).toBeInTheDocument();

    const robert = useStore.getState().record.people.find((p) => p.id === 'robert')!;
    expect(robert.conds.find((c) => c.id === 'cad')?.onsetDate).toBeUndefined();
  });

  it('writes a full onsetDate as soon as year, month and day are all entered, committing per field with no Save button', async () => {
    const user = userEvent.setup();
    render(<ConditionPicker personId="robert" />);
    const card = cadCard();

    await user.click(within(card).getByRole('button', { name: /add exact onset date/i }));
    await user.type(within(card).getByRole('spinbutton', { name: /^year$/i }), '2015');
    await user.selectOptions(within(card).getByRole('combobox', { name: /^month$/i }), '06');
    await user.selectOptions(within(card).getByRole('combobox', { name: /^day$/i }), '10');

    expect(within(card).getByText(/recorded as: june 10, 2015/i)).toBeInTheDocument();
    const robert = useStore.getState().record.people.find((p) => p.id === 'robert')!;
    expect(robert.conds.find((c) => c.id === 'cad')?.onsetDate).toBe('2015-06-10');
    // The unrelated onset-AGE field (a different fact — age, not a calendar date) is untouched.
    expect(within(card).getByLabelText(/onset age for coronary/i)).toHaveValue(60);
  });

  it('rejects an impossible day with an inline error and falls back to month-only precision', async () => {
    const user = userEvent.setup();
    render(<ConditionPicker personId="robert" />);
    const card = cadCard();

    await user.click(within(card).getByRole('button', { name: /add exact onset date/i }));
    await user.type(within(card).getByRole('spinbutton', { name: /^year$/i }), '2015');
    await user.selectOptions(within(card).getByRole('combobox', { name: /^month$/i }), '02');
    const daySelect = within(card).getByRole('combobox', { name: /^day$/i });
    await user.selectOptions(daySelect, '30');

    const alert = within(card).getByRole('alert');
    expect(alert).toHaveTextContent(/doesn't have a day 30/i);
    expect(daySelect).toHaveAttribute('aria-describedby', alert.id);

    const robert = useStore.getState().record.people.find((p) => p.id === 'robert')!;
    expect(robert.conds.find((c) => c.id === 'cad')?.onsetDate).toBe('2015-02');
  });

  it('shows an already-recorded onsetDate expanded immediately, with its own year field (no coarse-year sibling to lock to)', () => {
    act(() => useStore.getState().setConditionField('robert', 'cad', 'onsetDate', '2010-01-05'));
    render(<ConditionPicker personId="robert" />);
    const card = cadCard();

    expect(
      within(card).queryByRole('button', { name: /^\+ add exact onset date$/i }),
    ).not.toBeInTheDocument();
    expect(within(card).getByRole('spinbutton', { name: /^year$/i })).toHaveValue(2010);
    expect(within(card).getByRole('combobox', { name: /^month$/i })).toHaveValue('01');
    expect(within(card).getByRole('combobox', { name: /^day$/i })).toHaveValue('05');
    expect(within(card).getByText(/recorded as: january 5, 2010/i)).toBeInTheDocument();
  });

  it('removing the refinement clears onsetDate and collapses the disclosure', async () => {
    const user = userEvent.setup();
    act(() => useStore.getState().setConditionField('robert', 'cad', 'onsetDate', '2010-01-05'));
    render(<ConditionPicker personId="robert" />);
    const card = cadCard();

    await user.click(within(card).getByRole('button', { name: /remove exact onset date/i }));

    expect(within(card).getByRole('button', { name: /add exact onset date/i })).toBeInTheDocument();
    const robert = useStore.getState().record.people.find((p) => p.id === 'robert')!;
    expect(robert.conds.find((c) => c.id === 'cad')?.onsetDate).toBeUndefined();
  });
});
