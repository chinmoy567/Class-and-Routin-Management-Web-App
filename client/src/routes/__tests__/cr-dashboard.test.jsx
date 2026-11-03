import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fail, meResponse, mockApi, ok, renderApp } from '@/test/mockApi.jsx';
import { t } from '@/lib/i18n';

vi.mock('@/lib/socket', () => ({
  connectSocket: () => ({ on: () => {}, off: () => {}, disconnect: () => {} }),
  disconnectSocket: () => {},
  onEvent: () => () => {},
}));

// The free-room finder has its own tests; here it is a placeholder inside the page.
vi.mock('@/features/rooms/components/FreeRoomsFinder.jsx', () => ({
  FreeRoomsFinder: () => null,
}));

afterEach(() => vi.unstubAllGlobals());

const overview = (over = {}) => ({
  section: {
    id: 'sec1',
    name: 'CSE 2-I-A',
    level: 2,
    term: 'I',
    letter: 'A',
    department_id: 'd1',
  },
  semester: { id: 's1', name: 'Spring 2027', status: 'current' },
  my_role: 'cr',
  groups: [
    { id: 'g1', label: 'G1' },
    { id: 'g2', label: 'G2' },
  ],
  roster: [
    {
      enrolment_id: 'e1',
      user_id: 'u2',
      name: 'Anika Roster',
      photo_url: null,
      uv_id: '2112345',
      group_id: 'g2',
      group: 'G2',
      confirmed: true,
    },
  ],
  unconfirmed: [
    {
      id: 'u3',
      name: 'Chandan Due',
      photo_url: null,
      state: 'unconfirmed',
      applied: false,
      can_remind: true,
    },
    {
      id: 'u4',
      name: 'Gulshan Applicant',
      photo_url: null,
      state: 'claim_pending',
      applied: true,
      can_remind: false,
    },
  ],
  join_requests: {
    pending: [
      {
        id: 'e9',
        user_id: 'u5',
        full_name: 'Hasan New',
        email: 'hasan@baiust.ac.bd',
        uv_id: '2112999',
        escalated: false,
        status: 'pending',
        group: null,
        created_at: '2027-04-05T10:00:00Z',
      },
    ],
    read_only: [
      {
        id: 'e10',
        full_name: 'Imran Rejected',
        status: 'rejected',
        escalated: false,
        reason: 'Not in this section',
      },
    ],
  },
  flags: [],
  counts: { roster: 1, unconfirmed: 2, pending_requests: 1, open_flags: 0 },
  released: { room_requests: false },
  ...over,
});

const routine = () => ({
  section: {
    server_time: '2027-04-06T04:00:00.000Z',
    today: '2027-04-06',
    timezone: 'Asia/Dhaka',
    semester: { name: 'Spring 2027', start_date: '2027-04-04', end_date: '2027-10-04' },
    week: [],
    days: [],
    bookings: [],
    events: [],
    group_missing: false,
    is_teacher: false,
  },
  groups: [],
});

const base = (extra = {}) => ({
  'GET /api/auth/me': meResponse('dashboard', { kind: 'student', state: 'active' }),
  'GET /api/cr/sections/sec1/overview': ok(overview()),
  'GET /api/cr/sections/sec1/routine': ok(routine()),
  ...extra,
});

const openPage = () => renderApp('/cr/sections/sec1');

describe('CR/DCR dashboard page (spec 17)', () => {
  it('CRD-DSH-02 shows the section header, the roster and the join requests', async () => {
    mockApi(base());
    openPage();
    expect(await screen.findByRole('heading', { name: 'CSE 2-I-A' })).toBeInTheDocument();
    expect(screen.getByText(/You are CR/)).toBeInTheDocument();
    expect(screen.getByText('Anika Roster')).toBeInTheDocument();
    expect(screen.getByText('Hasan New')).toBeInTheDocument();
    expect(screen.getByText('Imran Rejected')).toBeInTheDocument();
  });

  it('CRD-DSH-03 the roster shows no phone or email', async () => {
    mockApi(base());
    openPage();
    const roster = (await screen.findByText('Anika Roster')).closest('li');
    expect(within(roster).queryByText(/@/)).toBeNull();
    expect(within(roster).getByText(/UV ID 2112345/)).toBeInTheDocument();
  });

  it('CRD-DSH-10 changing a roster student group sends the spec 10 group change', async () => {
    const calls = mockApi(
      base({
        'PATCH /api/enrolments/e1/group': ok({ id: 'e1', group_id: 'g1', group_set_by: 'cr' }),
      }),
    );
    openPage();
    const select = await screen.findByLabelText('Group for Anika Roster');
    await userEvent.selectOptions(select, 'g1');
    await waitFor(() => {
      const patch = calls.find((c) => c.method === 'PATCH');
      expect(patch).toMatchObject({ url: '/api/enrolments/e1/group', body: { group_id: 'g1' } });
    });
  });

  it('CRD-DSH-04 the reminder button only appears for an unconfirmed student and sends one reminder', async () => {
    const calls = mockApi(
      base({
        'POST /api/cr/sections/sec1/reminders': ok({ student_id: 'u3', date: '2027-04-06' }),
      }),
    );
    openPage();
    expect(await screen.findByText('Waiting for join approval')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send reminder to Chandan Due' }));
    await waitFor(() => {
      expect(calls.find((c) => c.method === 'POST' && c.url.includes('reminders'))).toMatchObject({
        body: { student_id: 'u3' },
      });
    });
    expect(await screen.findByText('Reminder sent to Chandan Due.')).toBeInTheDocument();
  });

  it('CRD-DSH-04 a second reminder the same day shows the server message and the page keeps working', async () => {
    mockApi(
      base({
        'POST /api/cr/sections/sec1/reminders': fail(429, 'RATE_LIMITED'),
      }),
    );
    openPage();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Send reminder to Chandan Due' }),
    );
    expect(await screen.findByText(t('errors.RATE_LIMITED'))).toBeInTheDocument();
  });

  it('CRD-DSH-09 rejecting needs a reason of at least 5 characters before anything is sent', async () => {
    const calls = mockApi(base({ 'POST /api/enrolments/e9/decision': ok({ id: 'e9' }) }));
    openPage();
    const row = (await screen.findByText('Hasan New')).closest('li');
    await userEvent.click(within(row).getByRole('button', { name: 'Reject' }));
    await userEvent.click(within(row).getByRole('button', { name: 'Confirm rejection' }));
    expect(
      await within(row).findByText('Give a reason of at least 5 characters.'),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.url === '/api/enrolments/e9/decision')).toBe(false);
  });

  it('CRD-DSH-09 accepting with a group sends that group with the decision', async () => {
    const calls = mockApi(base({ 'POST /api/enrolments/e9/decision': ok({ id: 'e9' }) }));
    openPage();
    const row = (await screen.findByText('Hasan New')).closest('li');
    await userEvent.selectOptions(within(row).getByLabelText('Group for Hasan New'), 'g1');
    await userEvent.click(within(row).getByRole('button', { name: 'Accept with group' }));
    await waitFor(() => {
      expect(calls.find((c) => c.url === '/api/enrolments/e9/decision')).toMatchObject({
        body: { decision: 'accept', group_id: 'g1' },
      });
    });
  });

  it('CRD-DSH-07 the free-room view is on the page, view only, with no request button yet (R2)', async () => {
    mockApi(base());
    openPage();
    expect(await screen.findByRole('heading', { name: 'Free rooms' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /request/i })).toBeNull();
  });

  it('CRD-DSH-11 the flag form asks for a description of at least 10 characters', async () => {
    const calls = mockApi(base({ 'POST /api/cr/sections/sec1/flags': ok({ id: 'f1' }) }));
    openPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Flag a problem' }));
    await userEvent.type(screen.getByLabelText('What is wrong'), 'too short');
    await userEvent.click(screen.getByRole('button', { name: 'Send flag' }));
    expect(
      await screen.findByText('Describe the problem in at least 10 characters.'),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.url.includes('flags'))).toBe(false);
  });

  it('CRD-DSH-11 a valid flag is sent with its category and description', async () => {
    const calls = mockApi(base({ 'POST /api/cr/sections/sec1/flags': ok({ id: 'f1' }) }));
    openPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Flag a problem' }));
    await userEvent.selectOptions(screen.getByLabelText('Category'), 'wrong_group');
    await userEvent.type(screen.getByLabelText('What is wrong'), 'Anika sits in G2 labs');
    await userEvent.click(screen.getByRole('button', { name: 'Send flag' }));
    await waitFor(() => {
      expect(calls.find((c) => c.method === 'POST' && c.url.includes('flags'))).toMatchObject({
        body: { category: 'wrong_group', description: 'Anika sits in G2 labs' },
      });
    });
  });

  it('CRD-DSH-01 a section this person cannot open shows the not-found message, not the data', async () => {
    mockApi({
      'GET /api/auth/me': meResponse('dashboard', { kind: 'student', state: 'active' }),
      'GET /api/cr/sections/sec1/overview': fail(404, 'NOT_FOUND'),
      'GET /api/cr/sections/sec1/routine': fail(404, 'NOT_FOUND'),
    });
    openPage();
    expect(await screen.findByText(/This section is not open to you/)).toBeInTheDocument();
    expect(screen.queryByText('Roster')).toBeNull();
  });
});
