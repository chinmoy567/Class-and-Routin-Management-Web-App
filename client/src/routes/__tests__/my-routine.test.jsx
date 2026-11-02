import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, waitFor, within, act } from '@testing-library/react';
import { mockApi, ok, renderApp, meResponse } from '@/test/mockApi.jsx';
import { t } from '@/lib/i18n';

vi.mock('@/lib/socket', () => ({
  connectSocket: () => ({ on: () => {}, off: () => {}, disconnect: () => {} }),
  disconnectSocket: () => {},
  onEvent: () => () => {},
}));

afterEach(() => vi.unstubAllGlobals());

// The page asks for the device-based window (today and six days on), as in the page code.
const deviceDay = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};
const ROUTINE_URL = `/api/me/routine?from=${deviceDay(0)}&to=${deviceDay(6)}`;

const teacher = { short_code: 'AR', full_name: 'Abdur Rahman' };
const slot = {
  slot_id: 'slot1',
  course_code: 'CSE-421',
  course_name: 'Compiler Design',
  group: null,
  group_id: null,
  day_of_week: 0,
  start_min: 510,
  end_min: 565,
  effective_end_min: 565,
  status: 'runs',
  room_code: '311',
  teachers: [teacher],
  department_id: 'd1',
  section_id: 's1',
  section_label: '2-I A',
};

/** A routine response. `today` is the institution date from the server (RTN-11). */
const routine = (over = {}) => ({
  server_time: '2027-04-04T04:00:00.000Z',
  today: '2027-04-04',
  timezone: 'Asia/Dhaka',
  semester: { name: 'Spring 2027', start_date: '2027-03-28', end_date: '2027-10-04' },
  week: [{ day_of_week: 0, slots: [slot] }],
  days: [
    {
      date: '2027-04-04',
      dayRule: { kind: 'normal' },
      slots: [slot],
    },
    { date: '2027-04-05', dayRule: { kind: 'normal' }, slots: [] },
  ],
  bookings: [],
  events: [],
  group_missing: false,
  is_teacher: false,
  ...over,
});

/** Wait until the routine has loaded (the heading shows during loading too). */
const loaded = () => screen.findAllByText('CSE-421');

const routes = (data) => ({
  'GET /api/auth/me': meResponse('dashboard'),
  [`GET ${ROUTINE_URL}`]: ok(data),
});

describe('my routine page (spec 12)', () => {
  it('RTN-16 shows the class with its course, teacher and room', async () => {
    mockApi(routes(routine()));
    renderApp('/routine');
    await loaded();
    expect(screen.getByRole('heading', { name: t('routine.title') })).toBeInTheDocument();
    expect(screen.getAllByText('CSE-421').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Abdur Rahman').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/311/).length).toBeGreaterThan(0);
  });

  it('RTN-07 the week grid shows the teacher short code', async () => {
    mockApi(routes(routine()));
    renderApp('/routine');
    await loaded();
    const grid = document.querySelector('table');
    expect(within(grid).getByText('AR')).toBeInTheDocument();
  });

  it("RTN-17 the week grid marks the server's today, not the device day", async () => {
    // The server says it is Thursday (2027-04-08), so Thursday is highlighted, not Sunday.
    mockApi(routes(routine({ today: '2027-04-08' })));
    renderApp('/routine');
    await loaded();
    const grid = document.querySelector('table');
    const headers = within(grid).getAllByRole('columnheader');
    const thursday = headers.find((th) => th.textContent === t('routine.dayThu'));
    const sunday = headers.find((th) => th.textContent === t('routine.daySun'));
    expect(thursday.className).toContain('font-bold');
    expect(sunday.className).not.toContain('font-bold');
  });

  it("RTN-18 the phone list opens on the server's today", async () => {
    mockApi(routes(routine()));
    renderApp('/routine');
    await loaded();
    const todayTab = await screen.findByRole('button', { name: t('routine.today') });
    expect(todayTab.className).toContain('bg-primary');
  });

  it('RTN-19 a student with no group sees the group notice', async () => {
    mockApi(routes(routine({ group_missing: true })));
    renderApp('/routine');
    expect(await screen.findByText(t('routine.groupMissing'))).toBeInTheDocument();
  });

  it('RTN-19 a student with a group sees no group notice', async () => {
    mockApi(routes(routine({ group_missing: false })));
    renderApp('/routine');
    await loaded();
    expect(screen.queryByText(t('routine.groupMissing'))).toBeNull();
  });

  it('RTN-12 refetches the routine when the tab becomes visible again', async () => {
    const calls = mockApi(routes(routine()));
    renderApp('/routine');
    await loaded();
    const before = calls.filter((c) => c.url === ROUTINE_URL).length;
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() =>
      expect(calls.filter((c) => c.url === ROUTINE_URL).length).toBeGreaterThan(before),
    );
  });
});
