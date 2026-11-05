import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { LiveStatusCard } from '../components/LiveStatusCard.jsx';

// Tuesday 2027-04-06 10:00 in Asia/Dhaka (04:00 UTC). The server time and the device clock agree.
const NOW = '2027-04-06T04:00:00.000Z';

const teacher = (full_name) => ({ short_code: full_name.slice(0, 2).toUpperCase(), full_name });

const slot = (over = {}) => ({
  slot_id: 'x',
  course_code: 'CSE-301',
  group: null,
  group_id: null,
  day_of_week: 2,
  start_min: 570, // 09:30
  end_min: 630, // 10:30
  effective_end_min: 630,
  status: 'runs',
  room_code: 'R311',
  teachers: [teacher('Arifur Bhuiyan')],
  ...over,
});

const day = (date, slots = []) => ({ date, dayRule: { kind: 'normal' }, slots });

const routine = (days) => ({
  server_time: NOW,
  today: '2027-04-06',
  timezone: 'Asia/Dhaka',
  semester: { name: 'Spring 2027', start_date: '2027-04-04', end_date: '2027-10-04' },
  week: [],
  days,
  bookings: [],
  events: [],
  group_missing: false,
  is_teacher: false,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => vi.useRealTimers());

describe('RTN-10 the countdown shows how long is left', () => {
  it('RTN-10 in class: the countdown is the minutes until the class ends', () => {
    render(<LiveStatusCard routineData={routine([day('2027-04-06', [slot()])])} />);
    expect(screen.getByText('In class')).toBeInTheDocument();
    expect(
      screen.getByText('CSE-301 · Arifur Bhuiyan · R311 · Class ends in 30 min'),
    ).toBeInTheDocument();
  });

  it('RTN-10 free, next class later today: the time left is a duration with teacher and room', () => {
    const next = slot({
      slot_id: 'n',
      course_code: 'CSE-421',
      start_min: 670, // 11:10
      end_min: 725,
      effective_end_min: 725,
      room_code: 'R405',
      teachers: [teacher('Chinmoy Dey')],
    });
    render(<LiveStatusCard routineData={routine([day('2027-04-06', [next])])} />);
    expect(screen.getByText('Free')).toBeInTheDocument();
    expect(
      screen.getByText('Next class CSE-421 in 1 h 10 min · Chinmoy Dey · R405'),
    ).toBeInTheDocument();
  });

  it('RTN-10 next class on another day: the date and clock time are shown, not a duration', () => {
    const later = slot({ slot_id: 'l', course_code: 'CSE-400', start_min: 510, end_min: 565 });
    render(
      <LiveStatusCard
        routineData={routine([day('2027-04-06'), day('2027-04-07'), day('2027-04-08', [later])])}
      />,
    );
    expect(screen.getByText(/Next class CSE-400 on 2027-04-08 at 08:30/)).toBeInTheDocument();
  });
});

describe('DSH-04 the status counts on its own, without a reload', () => {
  it('DSH-04 the countdown ticks down once a minute, with no new request', () => {
    render(<LiveStatusCard routineData={routine([day('2027-04-06', [slot()])])} />);
    expect(screen.getByText(/Class ends in 30 min/)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText(/Class ends in 29 min/)).toBeInTheDocument();
  });

  it('DSH-04 the status changes when a class ends, without a reload', () => {
    render(<LiveStatusCard routineData={routine([day('2027-04-06', [slot()])])} />);
    expect(screen.getByText('In class')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(31 * 60_000); // 10:31, after the class ends at 10:30
    });
    expect(screen.getByText('Free')).toBeInTheDocument();
  });

  it('BKG-18 an approved booking shows as In class for the section during its time', () => {
    // The server sends the booking as a dated running slot with no course code or teachers
    const booking = slot({
      slot_id: 'booking:b1',
      booking: true,
      course_code: '',
      course_name: 'Room booking',
      teachers: [],
      start_min: 600, // 10:00
      end_min: 630, // 10:30
      effective_end_min: 630,
      room_code: 'R311',
    });
    render(<LiveStatusCard routineData={routine([day('2027-04-06', [booking])])} />);
    expect(screen.getByText('In class')).toBeInTheDocument();
    expect(screen.getByText('R311 · Class ends in 30 min')).toBeInTheDocument();
  });
});
