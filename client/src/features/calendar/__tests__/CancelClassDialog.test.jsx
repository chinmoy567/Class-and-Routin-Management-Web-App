import { describe, it, expect, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { mockApi, ok, fail, raw } from '@/test/mockApi.jsx';
import { CancelClassDialog, weekdayOfDate } from '../components/CancelClassDialog.jsx';

afterEach(() => vi.unstubAllGlobals());

// Semester 4 Apr 2027 (Sunday) to 4 Oct 2027. The slot is a Sunday class (day_of_week 0).
const semester = { start_date: '2027-04-04', end_date: '2027-10-04' };
const slot = { id: 'slot1', course_code: 'CSE-301', day_of_week: 0, start: '09:00', end: '10:00' };

function renderDialog(onClose = () => {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CancelClassDialog slot={slot} semester={semester} onClose={onClose} />
    </QueryClientProvider>,
  );
}

const fillDate = (value) => fireEvent.change(screen.getByLabelText('Date'), { target: { value } });

describe('CAL-10 cancelling one class on one date', () => {
  it('CAL-10 the weekday helper counts Sunday as 0 from the date alone', () => {
    expect(weekdayOfDate('2027-04-04')).toBe(0); // Sunday
    expect(weekdayOfDate('2027-04-07')).toBe(3); // Wednesday
  });

  it('CAL-10-test1 a date on another weekday is refused and nothing is sent', async () => {
    const calls = mockApi({});
    renderDialog();
    fillDate('2027-04-07');
    await userEvent.type(screen.getByLabelText('Reason'), 'Teacher abroad');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel this class' }));
    expect(await screen.findByText('That date is not a Sunday.')).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('CAL-10 a date outside the current semester is refused', async () => {
    const calls = mockApi({});
    renderDialog();
    fillDate('2027-03-28'); // a Sunday, before the semester starts
    await userEvent.type(screen.getByLabelText('Reason'), 'Holiday');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel this class' }));
    expect(
      await screen.findByText('That date is outside the current semester.'),
    ).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('CAL-10 a reason is required to cancel', async () => {
    const calls = mockApi({});
    renderDialog();
    fillDate('2027-04-11');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel this class' }));
    expect(await screen.findByText('Enter a reason (up to 500 characters).')).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('CAL-10 a valid cancellation sends the date and reason to the slot', async () => {
    const calls = mockApi({
      'POST /api/slots/slot1/cancellations': ok({ date: '2027-04-11' }),
    });
    renderDialog();
    fillDate('2027-04-11');
    await userEvent.type(screen.getByLabelText('Reason'), 'Teacher abroad');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel this class' }));
    expect(await screen.findByText('The class is cancelled for that date.')).toBeInTheDocument();
    const post = calls.find((c) => c.method === 'POST');
    expect(post.body).toEqual({ date: '2027-04-11', reason: 'Teacher abroad' });
  });

  it('CAL-10-test1 cancelling the same class twice shows the conflict on the date', async () => {
    mockApi({
      'POST /api/slots/slot1/cancellations': fail(409, 'CONFLICT'),
    });
    renderDialog();
    fillDate('2027-04-11');
    await userEvent.type(screen.getByLabelText('Reason'), 'Again');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel this class' }));
    expect(
      await screen.findByText('That class is already cancelled on that date.'),
    ).toBeInTheDocument();
  });
});

describe('CAL-12 restoring a cancelled class', () => {
  it('CAL-12 restores a cancelled date and says so', async () => {
    const calls = mockApi({
      'DELETE /api/slots/slot1/cancellations/2027-04-11': raw(null, 204),
    });
    renderDialog();
    fillDate('2027-04-11');
    await userEvent.click(screen.getByRole('button', { name: 'Restore this class' }));
    expect(await screen.findByText('The class runs again on that date.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'DELETE').url).toBe(
      '/api/slots/slot1/cancellations/2027-04-11',
    );
  });

  it('CAL-12 a class that already started cannot be restored', async () => {
    mockApi({
      'DELETE /api/slots/slot1/cancellations/2027-04-11': fail(409, 'TOO_LATE'),
    });
    renderDialog();
    fillDate('2027-04-11');
    await userEvent.click(screen.getByRole('button', { name: 'Restore this class' }));
    expect(
      await screen.findByText('The class has already started. The cancellation cannot be undone.'),
    ).toBeInTheDocument();
  });
});

describe('the dialog is accessible', () => {
  it('names itself and marks a bad date for assistive tech', async () => {
    mockApi({});
    renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'Cancel one class' });
    expect(within(dialog).getByLabelText('Date')).toHaveAttribute('type', 'date');
    fillDate('2027-04-07');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel this class' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Date')).toHaveAttribute('aria-invalid', 'true'),
    );
  });
});
