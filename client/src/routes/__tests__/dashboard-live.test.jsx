import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { mockApi, ok, renderApp, meResponse } from '@/test/mockApi.jsx';
import { dhakaDate } from '@/features/dashboard/utils.js';

vi.mock('@/lib/socket', () => ({
  connectSocket: () => ({ on: () => {}, off: () => {}, disconnect: () => {} }),
  disconnectSocket: () => {},
  onEvent: () => () => {},
}));

// Only the clock is faked, so the fetches and React Query still settle as usual.
// Tuesday 2027-04-06 10:00 in Asia/Dhaka. A class runs 09:30 to 10:30.
const NOW = '2027-04-06T04:00:00.000Z';
const semester = {
  id: 'sem1',
  name: 'Spring 2027',
  start_date: '2027-04-04',
  end_date: '2027-10-04',
};
const teacher = { short_code: 'AB', full_name: 'Arifur Bhuiyan' };
const running = {
  slot_id: 'run',
  course_code: 'CSE-301',
  course_name: 'Algorithms',
  group: null,
  group_id: null,
  day_of_week: 2,
  start_min: 570,
  end_min: 630,
  effective_end_min: 630,
  status: 'runs',
  room_code: 'R311',
  teachers: [teacher],
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The routine the page asks for, built at the faked time. */
function routineFor(isTeacher) {
  const today = dhakaDate(0);
  return {
    url: `/api/me/routine?from=${dhakaDate(0)}&to=${dhakaDate(6)}`,
    body: {
      server_time: NOW,
      today,
      timezone: 'Asia/Dhaka',
      semester,
      week: [],
      days: [
        { date: today, dayRule: { kind: 'normal' }, slots: [running] },
        { date: dhakaDate(1), dayRule: { kind: 'normal' }, slots: [] },
      ],
      bookings: [],
      events: [],
      group_missing: false,
      is_teacher: isTeacher,
    },
  };
}

const summary = (kind) => ({
  kind,
  semester,
  upcoming_events: [],
  free_now: { free_count: 0, from: 600, to: 655, rooms: [] },
  reminders: { email: 'ok', phone_missing: false, photo_missing: false },
  ...(kind === 'teacher'
    ? {
        teacher_link: {
          linked: true,
          records: [{ short_code: 'AB', full_name: teacher.full_name }],
        },
        sections_taught: [],
      }
    : { section: null, representatives: [], courses: [] }),
});

describe('DSH-05 the student dashboard shows the class happening now', () => {
  it('DSH-05 "In class" with the course, the teacher and the room, and the countdown', async () => {
    const r = routineFor(false);
    mockApi({
      'GET /api/auth/me': meResponse('dashboard', { kind: 'student' }),
      'GET /api/me/dashboard': ok(summary('student')),
      [`GET ${r.url}`]: ok(r.body),
    });
    renderApp('/');
    expect(await screen.findByText('In class')).toBeInTheDocument();
    expect(
      await screen.findByText('CSE-301 · Arifur Bhuiyan · R311 · Class ends in 30 min'),
    ).toBeInTheDocument();
  });
});

describe('DSH-11 the teacher dashboard shows the teaching status', () => {
  it('DSH-11 "Teaching" with the class, and the countdown to its end', async () => {
    const r = routineFor(true);
    mockApi({
      'GET /api/auth/me': meResponse('dashboard', { kind: 'teacher' }),
      'GET /api/me/dashboard': ok(summary('teacher')),
      [`GET ${r.url}`]: ok(r.body),
    });
    renderApp('/');
    expect(await screen.findByText('Teaching')).toBeInTheDocument();
    expect(
      await screen.findByText('CSE-301 · Arifur Bhuiyan · R311 · Class ends in 30 min'),
    ).toBeInTheDocument();
  });
});
