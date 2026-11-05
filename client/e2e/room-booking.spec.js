import { test, expect } from '@playwright/test';
import { isReleased } from '@crm/shared';

// Spec 19 (room booking), browser checks on a phone. The API is answered by the test (page.route),
// the same way the dashboard check does it, so no database is needed. The request screens are
// released with R2; until R2 is the current release these checks are skipped, not failed.

const day = (offset) => {
  const d = new Date(Date.now() + offset * 86_400_000);
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' });
};
const TODAY = day(0);

const json = (route, data) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });

const teacherUser = {
  user: {
    id: 'u-teacher',
    full_name: 'Arifur Bhuiyan',
    kind: 'teacher',
    state: 'active',
    email_verified: true,
    email_bouncing: false,
  },
  roles: [{ role: 'teacher', department_id: 'd1' }],
  email_action_required: false,
  next: 'dashboard',
};

const adminUser = {
  user: {
    id: 'u-admin',
    full_name: 'Department Admin',
    kind: 'staff',
    state: 'active',
    email_verified: true,
    email_bouncing: false,
  },
  roles: [{ role: 'dept_admin', department_id: 'd1' }],
  email_action_required: false,
  next: 'dashboard',
};

const teacherDashboard = {
  kind: 'teacher',
  semester: { id: 'sem1', name: 'Spring 2027', start_date: '2027-04-04', end_date: '2027-10-04' },
  upcoming_events: [],
  free_now: { free_count: 0, from: 600, to: 655, rooms: [] },
  sections_taught: [{ section_id: 's1', name: 'CSE 2-I A' }],
  reminders: {
    email: 'ok',
    phone_missing: false,
    photo_missing: false,
    group_missing: false,
    semester_badge: { semester: 'Spring 2027', confirmed: true },
  },
};

const routine = {
  server_time: new Date().toISOString(),
  today: TODAY,
  timezone: 'Asia/Dhaka',
  semester: teacherDashboard.semester,
  week: [],
  days: [{ date: TODAY, dayRule: { kind: 'normal' }, slots: [] }],
  bookings: [],
  events: [],
  group_missing: false,
  is_teacher: true,
};

const availability = {
  date: TODAY,
  requests_allowed: true,
  rooms: [
    {
      id: 'r311',
      code: '311',
      type: 'classroom',
      status: 'free',
      requests_allowed: true,
      owner: { code: 'CSE' },
    },
  ],
};

/** Answers the APIs both flows use. Extra routes go on top of this. */
async function baseMocks(page, me) {
  await page.route('**/api/auth/csrf', (route) => json(route, { token: 'e2e-token' }));
  await page.route('**/api/auth/me', (route) => json(route, me));
  await page.route('**/socket.io/**', (route) => route.abort());
  await page.route('**/api/semesters/current', (route) =>
    route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'No current semester.' } }),
    }),
  );
  await page.route('**/api/me/dashboard', (route) => json(route, teacherDashboard));
  await page.route('**/api/me/routine?**', (route) => json(route, routine));
  await page.route('**/api/rooms/availability?**', (route) => json(route, availability));
  await page.route('**/api/me/room-requests', (route) => json(route, []));
  await page.route('**/api/departments**', (route) => json(route, []));
}

test.describe('BKG-01 to BKG-02 a teacher requests a room on a phone', () => {
  test.use({ viewport: { width: 360, height: 740 } });
  test.skip(
    !isReleased('dashboard.teacher.room_requests'),
    'Room requests are released with R2; this check runs once R2 is the current release.',
  );

  test('BKG-02 the teacher picks a group and a named teacher, and the request sends those ids', async ({
    page,
  }) => {
    await baseMocks(page, teacherUser);
    await page.route('**/api/room-requests/options?**', (route) =>
      json(route, {
        groups: [{ id: 'g1', label: 'G1' }],
        teachers: [{ id: 't1', label: 'Arifur Bhuiyan' }],
      }),
    );
    let sent = null;
    await page.route('**/api/room-requests', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      sent = route.request().postDataJSON();
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ data: { id: 'q1', status: 'pending' } }),
      });
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'Request 311' }).click();
    await expect(page.getByRole('heading', { name: 'Request 311' })).toBeVisible();
    await page.getByLabel('Group (optional)').selectOption('g1');
    await page.getByLabel('Teacher (optional)').selectOption('t1');
    await page.getByLabel('Why do you need the room?').fill('Lab class for G1');
    await page.getByRole('button', { name: 'Send request' }).click();

    await expect(
      page.getByText('Your request was sent. You will be told the result by email.'),
    ).toBeVisible();
    expect(sent).toMatchObject({
      room_id: 'r311',
      target_section_id: 's1',
      target_group_id: 'g1',
      named_teacher_id: 't1',
      note: 'Lab class for G1',
    });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });
});

test.describe('BKG-12 to BKG-13 an admin decides from the queue on a phone', () => {
  test.use({ viewport: { width: 360, height: 740 } });
  test.skip(
    !isReleased('admin.room_requests'),
    'The admin queue is released with R2; this check runs once R2 is the current release.',
  );

  test('BKG-13 approving a request from the queue sends the decision', async ({ page }) => {
    await baseMocks(page, adminUser);
    const queue = {
      groups: [
        {
          room_id: 'r311',
          room_code: '311',
          date: TODAY,
          start: 695,
          end: 750,
          requests: [
            {
              id: 'q1',
              room_id: 'r311',
              date: TODAY,
              start: 695,
              end: 750,
              note: 'Lab class for G1',
              status: 'pending',
              requester_label: 'CSE 2-I A',
              requester_no_shows: [{ date: '2027-03-31', note: 'Nobody came in.' }],
              other_requests: [],
            },
          ],
        },
      ],
    };
    await page.route('**/api/admin/room-requests?**', (route) => json(route, queue));
    let decision = null;
    await page.route('**/api/room-requests/q1/decision', async (route) => {
      decision = route.request().postDataJSON();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { id: 'q1', status: 'approved' } }),
      });
    });

    await page.goto('/admin/room-requests');
    await expect(page.getByText('CSE 2-I A')).toBeVisible();
    await expect(page.getByText('No-show on 2027-03-31: Nobody came in.')).toBeVisible();
    await page.getByRole('button', { name: 'Approve' }).click();
    await expect.poll(() => decision).toEqual({ decision: 'approve' });
  });
});
