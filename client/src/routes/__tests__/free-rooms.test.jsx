import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fail, meResponse, ok, renderApp } from '@/test/mockApi.jsx';

vi.mock('@/lib/socket', () => ({
  connectSocket: () => ({ on: () => {}, off: () => {}, disconnect: () => {} }),
  disconnectSocket: () => {},
  onEvent: () => () => {},
}));

afterEach(() => vi.unstubAllGlobals());

/**
 * The availability URL carries the chosen date and range, so the stub matches by path prefix
 * rather than by the full URL that mockApi needs.
 */
function stubApi(routes) {
  const calls = [];
  vi.stubGlobal('fetch', async (url) => {
    calls.push(url);
    const path = url.split('?')[0];
    if (path === '/api/auth/csrf') return ok({ token: 'csrf-token' });
    const handler = routes[path];
    if (!handler) return fail(404, 'NOT_FOUND');
    return typeof handler === 'function' ? handler(url) : handler;
  });
  return calls;
}

const departments = [
  { id: 'd1', code: 'CSE', name: 'Computer Science', setting_up: false, sections: [] },
];

const availability = (over = {}) => ({
  date: '2027-04-04',
  requests_allowed: true,
  day_label: null,
  rooms: [
    { id: 'r1', code: '311', type: 'classroom', owner: { id: 'd1', code: 'CSE' }, status: 'free' },
    { id: 'r2', code: '312', type: 'lab', owner: { id: 'd1', code: 'CSE' }, status: 'busy' },
  ],
  ...over,
});

const baseRoutes = (availabilityHandler = () => ok(availability())) => ({
  '/api/auth/me': meResponse('dashboard'),
  '/api/departments': ok(departments),
  '/api/rooms/availability': availabilityHandler,
});

describe('free-room page (spec 13)', () => {
  it('FRV-05 lists rooms by status and never shows a class or a teacher', async () => {
    stubApi(baseRoutes());
    renderApp('/rooms/free');
    const free = await screen.findByRole('region', { name: 'Free (1)' });
    expect(within(free).getByText('311')).toBeVisible();
    const busy = screen.getByRole('region', { name: 'In use (1)' });
    expect(within(busy).getByText('312')).toBeVisible();
    expect(screen.queryByText(/Compiler Design|CSE-421|Abdur Rahman/)).not.toBeInTheDocument();
  });

  it('FRV-01 the date can only be picked within this week or next week', async () => {
    stubApi(baseRoutes());
    renderApp('/rooms/free');
    const date = await screen.findByLabelText(/^Date/);
    expect(date).toHaveAttribute('min');
    expect(date).toHaveAttribute('max');
    const min = new Date(`${date.getAttribute('min')}T00:00:00`);
    const max = new Date(`${date.getAttribute('max')}T00:00:00`);
    // Sunday to the Saturday after next: at most 13 days from the first to the last day.
    expect(Math.round((max - min) / 86400000)).toBe(13);
    expect(min.getDay()).toBe(0);
    expect(max.getDay()).toBe(6);
  });

  it('FRV-03 an end time that is not after the start shows the range error and asks for no rooms', async () => {
    const calls = stubApi(baseRoutes());
    renderApp('/rooms/free');
    await screen.findByRole('region', { name: 'Free (1)' });
    const before = calls.filter((u) => u.startsWith('/api/rooms/availability')).length;
    await userEvent.selectOptions(screen.getByLabelText(/^From/), '660');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The end time must be after the start time.',
    );
    expect(calls.filter((u) => u.startsWith('/api/rooms/availability')).length).toBe(before);
  });

  it('FRV-04 on a day with no requests the notice names the day', async () => {
    stubApi(baseRoutes(() => ok(availability({ requests_allowed: false, day_label: 'Friday' }))));
    renderApp('/rooms/free');
    expect(
      await screen.findByText('Room requests are not allowed on this day: Friday.'),
    ).toBeVisible();
  });

  it('FRV-06 a filter that matches nothing shows the empty message', async () => {
    stubApi(baseRoutes(() => ok(availability({ rooms: [] }))));
    renderApp('/rooms/free');
    expect(await screen.findByText('No rooms match these filters.')).toBeVisible();
  });
});
