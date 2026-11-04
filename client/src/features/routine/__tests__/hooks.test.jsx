import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useLiveStatus, useMyRoutine } from '../hooks.js';

const fetchMyRoutine = vi.hoisted(() => vi.fn());
vi.mock('../api.js', () => ({ fetchMyRoutine }));

// Tuesday 2027-04-06 10:00 in Asia/Dhaka (04:00 UTC). A Maths class runs 09:30 to 10:30.
const SERVER_NOW = '2027-04-06T04:00:00.000Z';
const serverMs = Date.parse(SERVER_NOW);

const slot = {
  slot_id: 'x',
  course_code: 'CSE-301',
  group: null,
  group_id: null,
  day_of_week: 2,
  start_min: 570,
  end_min: 630,
  effective_end_min: 630,
  status: 'runs',
  room_code: 'R311',
  teachers: [],
};

const routine = {
  server_time: SERVER_NOW,
  today: '2027-04-06',
  timezone: 'Asia/Dhaka',
  semester: { name: 'Spring 2027', start_date: '2027-04-04', end_date: '2027-10-04' },
  week: [],
  days: [{ date: '2027-04-06', dayRule: { kind: 'normal' }, slots: [slot] }],
  bookings: [],
  events: [],
  group_missing: false,
  is_teacher: false,
};

function wrapperFor(client) {
  function Wrapper({ children }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}

beforeEach(() => {
  fetchMyRoutine.mockReset();
  fetchMyRoutine.mockResolvedValue(routine);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('RTN-11 the live status uses server time, not the device clock', () => {
  it('a device clock 20 minutes fast does not change the status or the countdown', () => {
    // The device says 20 minutes later than the server did when it sent the response.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(serverMs + 20 * 60_000));

    const { result } = renderHook(() => useLiveStatus(routine));

    expect(result.current.kind).toBe('in_class');
    // The class ends at 10:30 server time, so 30 minutes are left (not 10).
    expect(result.current.ends_at - result.current.now_min).toBe(30);
  });
});

describe('RTN-12 the status recomputes every minute with no request', () => {
  it('the status changes when a class ends, without a new request', async () => {
    // 10:29:30 on the server and on the device: the class is still running.
    const at = new Date(serverMs + 29 * 60_000 + 30_000);
    vi.useFakeTimers();
    vi.setSystemTime(at);

    const data = { ...routine, server_time: at.toISOString() };
    const { result } = renderHook(() => useLiveStatus(data));
    expect(result.current.kind).toBe('in_class');

    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });

    expect(result.current.kind).not.toBe('in_class');
    expect(fetchMyRoutine).not.toHaveBeenCalled();
  });
});

describe('RTN-12 the routine refetches every 5 minutes', () => {
  it('a second request is sent five minutes after the first', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => useMyRoutine('2027-04-06', '2027-04-19'), { wrapper: wrapperFor(client) });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMyRoutine).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000 + 1000);
    });
    expect(fetchMyRoutine).toHaveBeenCalledTimes(2);
    client.clear();
  });
});
