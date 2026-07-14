import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
