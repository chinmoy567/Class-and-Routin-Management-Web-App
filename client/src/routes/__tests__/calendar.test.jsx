import { describe, it, expect, afterEach, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockApi, ok, raw, renderApp, fail } from '@/test/mockApi.jsx';

vi.mock('@/lib/socket', () => ({
  connectSocket: () => ({ on: () => {}, off: () => {}, disconnect: () => {} }),
  disconnectSocket: () => {},
  onEvent: () => () => {},
}));

afterEach(() => vi.unstubAllGlobals());

const cse = { id: 'd1', code: 'CSE', name: 'Computer Science', retired: false };
const eee = { id: 'd2', code: 'EEE', name: 'Electrical', retired: false };
const semester = {
  id: 's1',
  name: 'Spring 2027',
  start_date: '2027-04-04',
  end_date: '2027-10-04',
};

const me = (roles) =>
  ok({
    user: {
      id: 'me',
      full_name: 'Some Admin',
      kind: 'teacher',
      state: 'active',
      email_verified: true,
      email_bouncing: false,
    },
    roles,
    email_action_required: false,
    next: 'dashboard',
  });
const superAdminMe = () => me([{ role: 'super_admin' }]);
const deptAdminMe = () => me([{ role: 'dept_admin', department_id: 'd1' }]);

const midterm = {
  id: 'e1',
  scope_department_id: null,
  from_date: '2027-06-07',
  to_date: '2027-06-07',
  kind: 'exam',
  label: 'Mid-term exam',
};
const eid = {
  id: 'e2',
  scope_department_id: null,
  from_date: '2027-06-10',
  to_date: '2027-06-10',
  kind: 'early_closing',
  cutoff_min: 720,
  label: 'Campus Day',
};
const fest = {
  id: 'e3',
  scope_department_id: 'd1',
  from_date: '2027-05-01',
  to_date: '2027-05-01',
  kind: 'dept_event',
  label: 'CSE FEST',
};

/** The routes every calendar page load needs. `extra` adds or overrides some. */
const base = (who, extra = {}) => ({
  'GET /api/auth/me': who,
  'GET /api/departments': ok([cse, eee]),
  'GET /api/admin/departments': ok([cse, eee]),
  'GET /api/semesters/current': ok(semester),
  'GET /api/calendar-events': ok([]),
  'GET /api/calendar-events?from=2027-04-04&to=2027-10-04': ok([midterm, eid, fest]),
  ...extra,
});

async function openAdd() {
  await screen.findByRole('heading', { name: 'University calendar' });
  await userEvent.click(await screen.findByRole('button', { name: 'Add event' }));
  return screen.getByRole('dialog', { name: 'Add a calendar event' });
}

describe('CAL-02 the calendar page lists events and limits what a department admin sees', () => {
  it('CAL-02 lists the events of the current semester', async () => {
    mockApi(base(superAdminMe()));
    renderApp('/admin/calendar');
    expect(await screen.findByText('Mid-term exam', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('Campus Day', { selector: 'p' })).toBeInTheDocument();
  });

  it('CAL-02 a department admin cannot edit or delete a university event', async () => {
    mockApi(base(deptAdminMe()));
    renderApp('/admin/calendar');
    await screen.findByText('Mid-term exam', { selector: 'p' });
    expect(screen.queryByRole('button', { name: /Edit Mid-term exam/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Delete Mid-term exam/ })).toBeNull();
    expect(await screen.findByRole('button', { name: /Edit CSE FEST/ })).toBeInTheDocument();
  });

  it('CAL-02 a department admin cannot pick the university scope', async () => {
    mockApi(base(deptAdminMe()));
    renderApp('/admin/calendar');
    const dialog = await openAdd();
    const scope = within(dialog).getByLabelText('Scope');
    expect(within(scope).queryByRole('option', { name: 'University' })).toBeNull();
    expect(within(scope).getByRole('option', { name: 'CSE Computer Science' })).toBeInTheDocument();
  });

  it('CAL-02 a super admin can pick the university scope', async () => {
    mockApi(base(superAdminMe()));
    renderApp('/admin/calendar');
    const dialog = await openAdd();
    expect(
      within(within(dialog).getByLabelText('Scope')).getByRole('option', { name: 'University' }),
    ).toBeInTheDocument();
  });
});

describe('CAL-01 the event form', () => {
  it('CAL-01 the cutoff field appears only for kinds that take one', async () => {
    mockApi(base(superAdminMe()));
    renderApp('/admin/calendar');
    const dialog = await openAdd();
    expect(within(dialog).queryByLabelText('Cutoff time')).toBeNull(); // holiday by default
    await userEvent.selectOptions(within(dialog).getByLabelText('Kind'), 'early_closing');
    expect(within(dialog).getByLabelText('Cutoff time')).toBeInTheDocument();
    await userEvent.selectOptions(within(dialog).getByLabelText('Kind'), 'exam');
    expect(within(dialog).queryByLabelText('Cutoff time')).toBeNull();
  });

  it('CAL-01 an early closing without a cutoff is refused on the client and sends nothing', async () => {
    const calls = mockApi(base(superAdminMe()));
    renderApp('/admin/calendar');
    const dialog = await openAdd();
    await userEvent.selectOptions(within(dialog).getByLabelText('Kind'), 'early_closing');
    fireEvent.change(within(dialog).getByLabelText('From date'), {
      target: { value: '2027-06-10' },
    });
    fireEvent.change(within(dialog).getByLabelText('To date'), { target: { value: '2027-06-10' } });
    await userEvent.type(within(dialog).getByLabelText('Label'), 'Campus Day');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(
      await within(dialog).findByText('Enter a cutoff time for this kind.'),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('CAL-01 the end date before the start date is refused on the client', async () => {
    const calls = mockApi(base(superAdminMe()));
    renderApp('/admin/calendar');
    const dialog = await openAdd();
    fireEvent.change(within(dialog).getByLabelText('From date'), {
      target: { value: '2027-06-10' },
    });
    fireEvent.change(within(dialog).getByLabelText('To date'), { target: { value: '2027-06-09' } });
    await userEvent.type(within(dialog).getByLabelText('Label'), 'Exam');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(
      await within(dialog).findByText('The end date must be on or after the start date.'),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('CAL-01 saving an early closing sends the cutoff in minutes', async () => {
    const calls = mockApi(
      base(superAdminMe(), {
        'POST /api/calendar-events': ok({ id: 'e9', label: 'Campus Day' }),
      }),
    );
    renderApp('/admin/calendar');
    const dialog = await openAdd();
    await userEvent.selectOptions(within(dialog).getByLabelText('Kind'), 'early_closing');
    fireEvent.change(within(dialog).getByLabelText('From date'), {
      target: { value: '2027-06-10' },
    });
    fireEvent.change(within(dialog).getByLabelText('To date'), { target: { value: '2027-06-10' } });
    fireEvent.change(within(dialog).getByLabelText('Cutoff time'), { target: { value: '12:00' } });
    await userEvent.type(within(dialog).getByLabelText('Label'), 'Campus Day');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const post = calls.find((c) => c.method === 'POST');
    expect(post.url).toBe('/api/calendar-events');
    expect(post.body).toEqual({
      scope: 'university',
      from_date: '2027-06-10',
      to_date: '2027-06-10',
      kind: 'early_closing',
      cutoff_min: 720,
      label: 'Campus Day',
    });
  });

  it('CAL-13 an event that affects bookings asks first, and saves with confirm when the admin agrees', async () => {
    const calls = mockApi(
      base(superAdminMe(), {
        'POST /api/calendar-events': [
          raw({ saved: false, affected_bookings: [{ id: 'b1' }] }),
          ok({ id: 'e9', label: 'Exam' }),
        ],
      }),
    );
    renderApp('/admin/calendar');
    const dialog = await openAdd();
    await userEvent.selectOptions(within(dialog).getByLabelText('Kind'), 'exam');
    fireEvent.change(within(dialog).getByLabelText('From date'), {
      target: { value: '2027-06-07' },
    });
    fireEvent.change(within(dialog).getByLabelText('To date'), { target: { value: '2027-06-07' } });
    await userEvent.type(within(dialog).getByLabelText('Label'), 'Exam');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByRole('heading', { name: 'Existing bookings will be affected' }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save and cancel those bookings' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts).toHaveLength(2);
    expect(posts[0].body.confirm).toBeUndefined();
    expect(posts[1].body.confirm).toBe(true);
  });
});

describe('CAL-05 deleting an event', () => {
  it('CAL-05 asks first, then deletes', async () => {
    const calls = mockApi(
      base(superAdminMe(), {
        'DELETE /api/calendar-events/e1': raw(null, 204),
      }),
    );
    renderApp('/admin/calendar');
    await screen.findByText('Mid-term exam', { selector: 'p' });
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Mid-term exam' }));
    expect(screen.getByRole('heading', { name: 'Delete this event?' })).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
    expect(calls.find((c) => c.method === 'DELETE').url).toBe('/api/calendar-events/e1');
  });

  it('CAL-05 a refused delete shows the reason and keeps the confirmation open', async () => {
    mockApi(
      base(superAdminMe(), {
        'DELETE /api/calendar-events/e1': fail(403, 'FORBIDDEN'),
      }),
    );
    renderApp('/admin/calendar');
    await screen.findByText('Mid-term exam', { selector: 'p' });
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Mid-term exam' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('You are not allowed to do this.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Delete this event?' })).toBeInTheDocument();
  });
});
