import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PartialDateFields } from './PartialDateFields';

/** Locks down `PartialDateFields`'s own accessibility contract, independent of any call
 * site (`TimelineView`'s `EventForm`, `ConditionPicker`'s onset picker): the disclosure's
 * focus management (WCAG 2.4.3), the invalid-day error's programmatic association, and the
 * value echo's live-region role. Real `userEvent`, not `fireEvent`, so focus really moves
 * the way a keyboard/AT user would observe it. */

describe('PartialDateFields — disclosure focus (WCAG 2.4.3)', () => {
  it('mode:locked — opening moves focus to the month select, the first field revealed', async () => {
    const user = userEvent.setup();
    render(
      <PartialDateFields
        mode="locked"
        lockedYear={2021}
        idBase="ev"
        legend="Exact date (optional)"
        initialValue={undefined}
        onChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /^\+ add exact date$/i }));

    expect(screen.getByRole('combobox', { name: /^month$/i })).toHaveFocus();
  });

  it('mode:free — opening moves focus to the year input, the first field revealed', async () => {
    const user = userEvent.setup();
    render(
      <PartialDateFields
        mode="free"
        idBase="onset"
        legend="Exact date (optional)"
        initialValue={undefined}
        onChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /^\+ add exact date$/i }));

    expect(screen.getByLabelText(/^year$/i)).toHaveFocus();
  });

  it('does not steal focus on mount when it starts already open (an existing precise date)', () => {
    render(
      <>
        <button type="button">something else on the page</button>
        <PartialDateFields
          mode="locked"
          lockedYear={2021}
          idBase="ev"
          legend="Exact date (optional)"
          initialValue="2021-06-05"
          onChange={vi.fn()}
        />
      </>,
    );

    // Already expanded (no trigger button), but focus was never forced into it.
    expect(screen.queryByRole('button', { name: /^\+ add exact date$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /^month$/i })).not.toHaveFocus();
  });

  it('removing returns focus to the "+ Add exact date" trigger once it remounts', async () => {
    const user = userEvent.setup();
    render(
      <PartialDateFields
        mode="locked"
        lockedYear={2021}
        idBase="ev"
        legend="Exact date (optional)"
        initialValue="2021-06-05"
        onChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /^remove exact date$/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^\+ add exact date$/i })).toHaveFocus(),
    );
  });
});

describe('PartialDateFields — invalid-day error association', () => {
  it('surfaces an impossible day as a role="alert" wired to the day select via aria-describedby/aria-invalid', async () => {
    const user = userEvent.setup();
    render(
      <PartialDateFields
        mode="locked"
        lockedYear={2021}
        idBase="ev"
        legend="Exact date (optional)"
        initialValue={undefined}
        onChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /^\+ add exact date$/i }));
    await user.selectOptions(screen.getByRole('combobox', { name: /^month$/i }), 'February');
    await user.selectOptions(screen.getByRole('combobox', { name: /^day$/i }), '30');

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/february doesn.t have a day 30/i);

    const daySelect = screen.getByRole('combobox', { name: /^day$/i });
    expect(daySelect).toHaveAttribute('aria-invalid', 'true');
    expect(daySelect).toHaveAttribute('aria-describedby', alert.id);
  });

  it('clears the error and its association once a valid day is chosen', async () => {
    const user = userEvent.setup();
    render(
      <PartialDateFields
        mode="locked"
        lockedYear={2021}
        idBase="ev"
        legend="Exact date (optional)"
        initialValue={undefined}
        onChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /^\+ add exact date$/i }));
    await user.selectOptions(screen.getByRole('combobox', { name: /^month$/i }), 'February');
    await user.selectOptions(screen.getByRole('combobox', { name: /^day$/i }), '30');
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await user.selectOptions(screen.getByRole('combobox', { name: /^day$/i }), '15');

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /^day$/i })).not.toHaveAttribute('aria-invalid');
  });
});

describe('PartialDateFields — value echo & labels', () => {
  it('the "Recorded as" confirmation is a role="status" live region', async () => {
    const user = userEvent.setup();
    render(
      <PartialDateFields
        mode="locked"
        lockedYear={2021}
        idBase="ev"
        legend="Exact date (optional)"
        initialValue={undefined}
        onChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /^\+ add exact date$/i }));
    await user.selectOptions(screen.getByRole('combobox', { name: /^month$/i }), 'June');

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(/recorded as: june 2021/i);
  });

  it('the month and day fields both have accessible labels', async () => {
    const user = userEvent.setup();
    render(
      <PartialDateFields
        mode="locked"
        lockedYear={2021}
        idBase="ev"
        legend="Exact date (optional)"
        initialValue={undefined}
        onChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /^\+ add exact date$/i }));

    expect(screen.getByLabelText(/^month$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^day$/i)).toBeInTheDocument();
  });
});

describe('PartialDateFields — mode:free year-change-clears', () => {
  it('clearing the year disables month/day and clears the committed value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <PartialDateFields
        mode="free"
        idBase="onset"
        legend="Exact date (optional)"
        initialValue={undefined}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole('button', { name: /^\+ add exact date$/i }));
    await user.type(screen.getByLabelText(/^year$/i), '2019');
    await user.selectOptions(screen.getByRole('combobox', { name: /^month$/i }), 'June');
    await user.selectOptions(screen.getByRole('combobox', { name: /^day$/i }), '15');

    expect(screen.getByRole('status')).toHaveTextContent(/recorded as: june 15, 2019/i);
    expect(onChange).toHaveBeenLastCalledWith('2019-06-15');

    await user.clear(screen.getByLabelText(/^year$/i));

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    expect(screen.getByRole('combobox', { name: /^month$/i })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: /^day$/i })).toBeDisabled();
  });
});
