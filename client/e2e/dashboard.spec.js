import { test, expect } from '@playwright/test';

// DSH-01 smoke check: the student dashboard's main content on a 360 px phone, with the API
// answering over a simulated 4G link. The app shell is warmed first, so the timing covers the
// dashboard's own data (the summary and the routine), not the first download of the bundle.

const day = (offset) => {
  const d = new Date(Date.now() + offset * 86_400_000);
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' });
};
const TODAY = day(0);
const TOMORROW = day(1);

const teacher = { short_code: 'AB', full_name: 'Arifur Bhuiyan' };
const slot = {
  slot_id: 'slot1',
  course_code: 'CSE-301',
  course_name: 'Algorithms',
  group: null,
  group_id: null,
  day_of_week: new Date(`${TODAY}T00:00:00Z`).getUTCDay(),
  start_min: 510,
  end_min: 565,
  effective_end_min: 565,
  status: 'runs',
  room_code: 'R311',
  teachers: [teacher],
};

const me = {
  user: {
    id: 'u1',
    full_name: 'Rafi Ahmed',
    kind: 'student',
    state: 'active',
    email_verified: true,
    email_bouncing: false,
  },
  roles: [],
  email_action_required: false,
  next: 'dashboard',
};

const dashboard = {
  kind: 'student',
  semester: { id: 'sem1', name: 'Spring 2027', start_date: '2027-04-04', end_date: '2027-10-04' },
  upcoming_events: [],
  free_now: { free_count: 0, from: 600, to: 655, rooms: [] },
  section: {
    id: 's1',
    name: 'CSE 2-I A',
    level: 2,
    term: 'I',
    letter: 'A',
    group: 'G1',
    my_role: null,
  },
  representatives: [],
  courses: [{ course_code: 'CSE-301', course_name: 'Algorithms', teachers: [teacher] }],
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
  semester: dashboard.semester,
  week: [{ day_of_week: slot.day_of_week, slots: [slot] }],
  days: [
    { date: TODAY, dayRule: { kind: 'normal' }, slots: [slot] },
    { date: TOMORROW, dayRule: { kind: 'normal' }, slots: [] },
  ],
  bookings: [],
  events: [],
  group_missing: false,
  is_teacher: false,
};

const json = (route, data) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });

// A 4G round trip is roughly 150 ms; this adds that to every API answer.
const FOUR_G_DELAY_MS = 150;
const throttled = (data) => async (route) => {
  await new Promise((resolve) => setTimeout(resolve, FOUR_G_DELAY_MS));
  return json(route, data);
};

async function mockApi(page) {
  await page.route('**/api/auth/csrf', (route) => json(route, { token: 'e2e-token' }));
  await page.route('**/api/auth/me', (route) => json(route, me));
  await page.route('**/socket.io/**', (route) => route.abort());
  // The header's "current semester" line is not part of this check; answer it with no semester.
  await page.route('**/api/semesters/current', (route) =>
    route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'No current semester.' } }),
    }),
  );
  await page.route('**/api/me/dashboard', throttled(dashboard));
  await page.route('**/api/me/routine?**', throttled(routine));
}

test.describe('DSH-01 student dashboard on a phone', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test('DSH-01 the main content renders within 2 s on a simulated 4G link, with no horizontal scroll', async ({
    page,
  }) => {
    await mockApi(page);

    // Warm the app shell and the service worker first.
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    const started = Date.now();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 2000 });
    await expect(page.getByRole('heading', { name: "Today's classes" })).toBeVisible({
      timeout: 2000,
    });
    const elapsed = Date.now() - started;
    // Smoke check on CI hardware: the budget is 2 s at the 95th percentile on a mid-range phone.
    expect(elapsed).toBeLessThan(2000);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });
});
