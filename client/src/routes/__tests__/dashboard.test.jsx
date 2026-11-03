import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockApi, ok, fail, renderApp, meResponse } from '@/test/mockApi.jsx';
import { t } from '@/lib/i18n';
import { dhakaDate } from '@/features/dashboard/utils.js';

vi.mock('@/lib/socket', () => ({
  connectSocket: () => ({ on: () => {}, off: () => {}, disconnect: () => {} }),
  disconnectSocket: () => {},
  onEvent: () => () => {},
}));

afterEach(() => vi.unstubAllGlobals());

const TODAY = dhakaDate(0);
const TOMORROW = dhakaDate(1);
const ROUTINE_URL = `/api/me/routine?from=${dhakaDate(0)}&to=${dhakaDate(6)}`;

const semester = {
  id: 'sem1',
  name: 'Spring 2027',
  start_date: '2027-04-04',
  end_date: '2027-10-04',
};

const teacherAB = { short_code: 'AB', full_name: 'Arifur Bhuiyan' };
const classToday = {
  slot_id: 'slot1',
  course_code: 'CSE-301',
  course_name: 'Algorithms',
  group: null,
  group_id: null,
  day_of_week: 2,
  start_min: 510,
  end_min: 565,
  effective_end_min: 565,
  status: 'runs',
  room_code: 'R311',
  teachers: [teacherAB],
};

/** The routine window the page asks for, with today's classes. */
const routine = (over = {}) => ({
  server_time: new Date().toISOString(),
  today: TODAY,
  timezone: 'Asia/Dhaka',
  semester,
  week: [{ day_of_week: 2, slots: [classToday] }],
  days: [
    { date: TODAY, dayRule: { kind: 'normal' }, slots: [classToday] },
    { date: TOMORROW, dayRule: { kind: 'normal' }, slots: [] },
  ],
  bookings: [],
  events: [],
  group_missing: false,
  is_teacher: false,
  ...over,
});

const studentDashboard = (over = {}) => ({
  kind: 'student',
  semester,
  upcoming_events: [
    {
      id: 'e1',
      from_date: '2027-04-08',
      to_date: '2027-04-08',
      kind: 'holiday',
      label: 'Eid holiday',
    },
  ],
  free_now: {
    free_count: 1,
    from: 600,
    to: 655,
    rooms: [{ id: 'r1', code: 'R311', type: 'classroom' }],
  },
  section: {
    id: 's1',
    name: 'CSE 2-I A',
    level: 2,
    term: 'I',
    letter: 'A',
    group: null,
    my_role: null,
  },
  representatives: [{ user_id: 'u9', role: 'cr', name: 'Karim CR', photo: null }],
  courses: [{ course_code: 'CSE-301', course_name: 'Algorithms', teachers: [teacherAB] }],
  reminders: {
    email: 'ok',
    phone_missing: false,
    photo_missing: false,
    group_missing: true,
    semester_badge: { semester: 'Spring 2027', confirmed: true },
  },
  ...over,
});

const teacherDashboard = (over = {}) => ({
  kind: 'teacher',
  semester,
  upcoming_events: [],
  free_now: { free_count: 0, from: 600, to: 655, rooms: [] },
  teacher_link: { linked: true, records: [{ short_code: 'AB', full_name: 'Arifur Bhuiyan' }] },
  sections_taught: [
    { section_id: 's1', name: 'CSE 2-I A', student_count: 2 },
    { section_id: 's2', name: 'CSE 2-I B', student_count: 0 },
  ],
  reminders: { email: 'ok', phone_missing: true, photo_missing: true },
  ...over,
});

const roster = [
  { user_id: 'a', name: 'Rahim Uddin', photo: null, uv_id: '0822310205101077', group: 'G1' },
  { user_id: 'b', name: 'Karim Hasan', photo: null, uv_id: null, group: null },
];

const studentRoutes = (dash = studentDashboard(), r = routine()) => ({
  'GET /api/auth/me': meResponse('dashboard', { kind: 'student' }),
  'GET /api/me/dashboard': ok(dash),
  [`GET ${ROUTINE_URL}`]: ok(r),
});

const teacherRoutes = (dash = teacherDashboard(), r = routine({ is_teacher: true })) => ({
  'GET /api/auth/me': meResponse('dashboard', { kind: 'teacher' }),
  'GET /api/me/dashboard': ok(dash),
  [`GET ${ROUTINE_URL}`]: ok(r),
});

describe('DSH-01 to DSH-10 the student dashboard', () => {
  it('DSH-03 shows the cards in one column: today, notices, rooms, section, reminders', async () => {
    mockApi(studentRoutes());
    renderApp('/');
    expect(await screen.findByRole('heading', { name: t('dashboard.title') })).toBeInTheDocument();
    await screen.findByRole('region', { name: 'CSE 2-I A' });
    expect(screen.getByRole('heading', { name: t('dashboard.today') })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: t('dashboard.notices') })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: t('dashboard.rooms') })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'CSE 2-I A' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: t('dashboard.reminders') })).toBeInTheDocument();
  });

  it('DSH-02 with R3 not released there is no messages card on the page', async () => {
    mockApi(studentRoutes());
    renderApp('/');
    await screen.findByRole('heading', { name: t('dashboard.title') });
    expect(screen.queryByText(/messages/i)).not.toBeInTheDocument();
  });

  it('DSH-06 today lists the class, and the week grid is in the DOM', async () => {
    mockApi(studentRoutes());
    renderApp('/');
    await screen.findByRole('heading', { name: t('dashboard.today') });
    expect(screen.getAllByText('CSE-301').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: t('dashboard.week') })).toBeInTheDocument();
  });

  it('DSH-07 lists the upcoming calendar events', async () => {
    mockApi(studentRoutes());
    renderApp('/');
    expect(await screen.findByText('Eid holiday')).toBeInTheDocument();
  });

  it('DSH-08 lists the free rooms now, with the link to the free-room view', async () => {
    mockApi(studentRoutes());
    renderApp('/');
    expect(
      await screen.findByText(t('dashboard.roomsCount').replace('{count}', '1')),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: t('dashboard.roomsSeeAll') })).toHaveAttribute(
      'href',
      '/rooms/free',
    );
  });

  it('DSH-09 shows the CR, and the courses with the teacher of the group', async () => {
    mockApi(studentRoutes());
    renderApp('/');
    const section = await screen.findByRole('region', { name: 'CSE 2-I A' });
    expect(within(section).getByText(/Karim CR/)).toBeInTheDocument();
    expect(within(section).getByText(/CSE-301/)).toBeInTheDocument();
    expect(within(section).getByText(/Arifur Bhuiyan/)).toBeInTheDocument();
  });

  it('DSH-10 a student with no group sees the group notice', async () => {
    mockApi(studentRoutes());
    renderApp('/');
    expect(await screen.findByText(t('dashboard.groupMissing'))).toBeInTheDocument();
    expect(
      screen.getByText(t('dashboard.semesterConfirmed').replace('{semester}', 'Spring 2027')),
    ).toBeInTheDocument();
  });

  it('DSH-10 privacy: the page never shows an email address', async () => {
    mockApi(studentRoutes());
    renderApp('/');
    await screen.findByRole('heading', { name: t('dashboard.title') });
    expect(document.body.textContent).not.toMatch(/@/);
  });

  it('DSH-01 a failed summary shows the error with a retry button', async () => {
    mockApi({
      'GET /api/auth/me': meResponse('dashboard', { kind: 'student' }),
      'GET /api/me/dashboard': fail(500, 'INTERNAL'),
      [`GET ${ROUTINE_URL}`]: ok(routine()),
    });
    renderApp('/');
    expect(await screen.findByText(t('dashboard.error'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('dashboard.retry') })).toBeInTheDocument();
  });
});

describe('DSH-11 to DSH-16 the teacher dashboard', () => {
  it('DSH-16 an unlinked teacher sees the not-linked notice', async () => {
    mockApi(
      teacherRoutes(
        teacherDashboard({
          teacher_link: { linked: false, records: [] },
          sections_taught: [],
        }),
        routine({ is_teacher: true, week: [], days: [], today: TODAY }),
      ),
    );
    renderApp('/');
    expect(await screen.findByText(t('dashboard.notLinked'))).toBeInTheDocument();
  });

  it('DSH-16 a linked teacher sees their short code and name', async () => {
    mockApi(teacherRoutes());
    renderApp('/');
    expect(
      await screen.findByText(
        t('dashboard.linked').replace('{code}', 'AB').replace('{name}', 'Arifur Bhuiyan'),
      ),
    ).toBeInTheDocument();
  });

  it('DSH-13 opening a section shows its roster: name, UV ID and group, no contact details', async () => {
    const calls = mockApi({
      ...teacherRoutes(),
      'GET /api/sections/s1/roster': ok(roster),
    });
    renderApp('/');
    const user = userEvent.setup();
    const sectionRow = (await screen.findByText('CSE 2-I A')).closest('li');
    await user.click(within(sectionRow).getByRole('button', { name: t('dashboard.showRoster') }));

    expect(await screen.findByText('Rahim Uddin')).toBeInTheDocument();
    expect(screen.getByText('Karim Hasan')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/@/);
    expect(calls.some((c) => c.url === '/api/sections/s1/roster')).toBe(true);
  });

  it('DSH-13 a section the teacher does not teach shows the refusal, not the students', async () => {
    mockApi({
      ...teacherRoutes(),
      'GET /api/sections/s2/roster': fail(404, 'NOT_FOUND'),
    });
    renderApp('/');
    const user = userEvent.setup();
    const sectionRow = (await screen.findByText('CSE 2-I B')).closest('li');
    await user.click(within(sectionRow).getByRole('button', { name: t('dashboard.showRoster') }));
    expect(await screen.findByText(t('dashboard.rosterError'))).toBeInTheDocument();
  });

  it('DSH-13 the roster is not fetched until the section is opened', async () => {
    const calls = mockApi({
      ...teacherRoutes(),
      'GET /api/sections/s1/roster': ok(roster),
    });
    renderApp('/');
    await screen.findByText('CSE 2-I A');
    expect(calls.some((c) => c.url.includes('/roster'))).toBe(false);
  });

  it('DSH-14 the teacher rooms card links to the page where a date and time can be picked', async () => {
    mockApi(teacherRoutes());
    renderApp('/');
    expect(await screen.findByRole('link', { name: t('dashboard.roomsPickTime') })).toHaveAttribute(
      'href',
      '/rooms/free',
    );
  });
});

describe('DSH-16 teacher reminders', () => {
  it('DSH-16 a teacher with no phone or photo is reminded', async () => {
    mockApi(teacherRoutes());
    renderApp('/');
    expect(await screen.findByText(t('dashboard.phoneMissing'))).toBeInTheDocument();
    expect(screen.getByText(t('dashboard.photoMissing'))).toBeInTheDocument();
  });
});
