import { describe, it, expect, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { mockApi, ok, fail } from '@/test/mockApi.jsx';
import { RequestRoomDialog } from '../components/RequestRoomDialog.jsx';
import { MyRoomRequestsCard } from '../components/MyRoomRequestsCard.jsx';
import { RoomRequestsCard } from '../components/RoomRequestsCard.jsx';
import { RoomStatusGroups } from '@/features/rooms/components/RoomStatusGroups.jsx';
import { AdminRoomRequestsPage } from '@/routes/admin/AdminRoomRequestsPage.jsx';

// The socket is not needed here; the release flags are forced on so the screens render (R2 is not shipped yet).
vi.mock('@/lib/socket', () => ({ onEvent: () => () => {} }));
vi.mock('@crm/shared', async (orig) => ({ ...(await orig()), isReleased: () => true }));

afterEach(() => vi.unstubAllGlobals());

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrap = (ui) => (
  <MemoryRouter>
    <QueryClientProvider client={client()}>{ui}</QueryClientProvider>
  </MemoryRouter>
);

const room = { id: 'r311', code: '311' };
const targets = [{ id: 'sec1', label: 'CSE 3-II-A' }];

function renderDialog(onClose = () => {}) {
  return render(
    wrap(
      <RequestRoomDialog
        room={room}
        date="2027-04-07"
        from={695}
        to={750}
        targets={targets}
        onClose={onClose}
      />,
    ),
  );
}

const sendRoute = (response) => ({ 'POST /api/room-requests': response });

describe('BKG-02 the request form', () => {
  it('BKG-02 a note shorter than 5 characters is refused and nothing is sent', async () => {
    const calls = mockApi(sendRoute(ok({ id: 'x' })));
    renderDialog();
    await userEvent.type(screen.getByLabelText('Why do you need the room?'), 'lab');
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByText('Write at least 5 characters.')).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('BKG-02 an end time before the start is refused', async () => {
    const calls = mockApi(sendRoute(ok({ id: 'x' })));
    renderDialog();
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '660' } }); // 11:00, start 11:35
    await userEvent.type(screen.getByLabelText('Why do you need the room?'), 'Lab class');
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(
      await screen.findByText('The end time must be after the start time.'),
    ).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('BKG-02 a range longer than 3 hours is refused', async () => {
    const calls = mockApi(sendRoute(ok({ id: 'x' })));
    renderDialog();
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '480' } }); // 08:00
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '1020' } }); // 17:00
    await userEvent.type(screen.getByLabelText('Why do you need the room?'), 'Long lab');
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(
      await screen.findByText('A request lasts from 30 minutes to 3 hours.'),
    ).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('BKG-01 a valid form sends the room, date, range, note and section, and says it was sent', async () => {
    const calls = mockApi(sendRoute(ok({ id: 'x' })));
    renderDialog();
    await userEvent.type(screen.getByLabelText('Why do you need the room?'), 'Lab class for G1');
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(
      await screen.findByText('Your request was sent. You will be told the result by email.'),
    ).toBeInTheDocument();
    const sent = calls.find((c) => c.method === 'POST');
    expect(sent.body).toEqual({
      room_id: 'r311',
      date: '2027-04-07',
      start: 695,
      end: 750,
      note: 'Lab class for G1',
      target_section_id: 'sec1',
    });
  });

  it('BKG-11 a refusal shows the reason the server gives, from its code', async () => {
    mockApi(sendRoute(fail(409, 'REQUEST_LIMIT')));
    renderDialog();
    await userEvent.type(screen.getByLabelText('Why do you need the room?'), 'Lab class for G1');
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(
      await screen.findByText('You already have 3 open requests that overlap this time.'),
    ).toBeInTheDocument();
  });

  it('BKG-09 a request sent too late shows the 12-hour rule', async () => {
    mockApi(sendRoute(fail(409, 'TOO_LATE')));
    renderDialog();
    await userEvent.type(screen.getByLabelText('Why do you need the room?'), 'Lab class for G1');
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(
      await screen.findByText('Requests must be sent at least 12 hours before the start.'),
    ).toBeInTheDocument();
  });
});

describe('BKG-01, BKG-19 who sees the request button', () => {
  const rooms = [
    {
      id: 'a',
      code: '311',
      type: 'classroom',
      owner: { code: 'CSE' },
      status: 'free',
      requests_allowed: true,
    },
    { id: 'b', code: '405', type: 'lab', owner: { code: 'EEE' }, status: 'booked' },
  ];

  it('BKG-01 a free room gets a Request button only when the viewer may request', () => {
    const { rerender } = render(<RoomStatusGroups rooms={rooms} />);
    expect(screen.queryByRole('button', { name: 'Request 311' })).toBeNull();
    rerender(<RoomStatusGroups rooms={rooms} onRequest={() => {}} />);
    expect(screen.getByRole('button', { name: 'Request 311' })).toBeInTheDocument();
  });

  it('BKG-19 a booked room never gets a Request button, and no booker details are shown', () => {
    render(<RoomStatusGroups rooms={rooms} onRequest={() => {}} />);
    const booked = screen.getByRole('region', { name: 'Booked (1)' }).closest('section');
    expect(within(booked).queryByRole('button')).toBeNull();
    expect(within(booked).getByText('405')).toBeInTheDocument();
  });
});

describe('BKG-26 my room requests', () => {
  it('BKG-26 lists each request with its status and reason, and cancels an open one', async () => {
    const calls = mockApi({
      'GET /api/me/room-requests': ok([
        {
          id: 'q1',
          room_code: '311',
          date: '2027-04-07',
          start: 695,
          end: 750,
          status: 'pending',
          reason: null,
        },
        {
          id: 'q2',
          room_code: '312',
          date: '2027-04-08',
          start: 600,
          end: 660,
          status: 'rejected',
          reason: 'room_given_to_another',
        },
      ]),
      'POST /api/room-requests/q1/cancel': ok({ id: 'q1', status: 'cancelled' }),
    });
    render(wrap(<MyRoomRequestsCard />));
    expect(await screen.findByText('Waiting for a decision')).toBeInTheDocument();
    expect(screen.getByText('Not approved · room_given_to_another')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel request' }));
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/room-requests/q1/cancel')).toBe(
      true,
    );
  });

  it('BKG-26 a teacher with no requests sees the empty message', async () => {
    mockApi({ 'GET /api/me/room-requests': ok([]) });
    render(wrap(<MyRoomRequestsCard />));
    expect(await screen.findByText('You have not sent any room requests yet.')).toBeInTheDocument();
  });
});

describe('BKG-12 to BKG-14 the decision queue', () => {
  const queue = {
    groups: [
      {
        room_id: 'r311',
        room_code: '311',
        date: '2027-04-07',
        start: 695,
        end: 750,
        requests: [
          { id: 'd1', requester_label: 'CSE 3-II-A', note: 'Lab class for G1', other_requests: [] },
          {
            id: 'd2',
            requester_label: 'CSE 3-II-B',
            note: 'Make-up class',
            other_requests: [{ id: 'o', room_id: 'r', status: 'pending' }],
          },
        ],
      },
    ],
  };

  it('BKG-12 the queue groups requests by room and slot, showing the requester and note', async () => {
    mockApi({ 'GET /api/admin/room-requests?status=pending': ok(queue) });
    render(wrap(<AdminRoomRequestsPage />));
    expect(await screen.findByRole('region', { name: '311 2027-04-07' })).toBeInTheDocument();
    expect(screen.getByText('CSE 3-II-A')).toBeInTheDocument();
    expect(screen.getByText('Make-up class')).toBeInTheDocument();
    expect(
      screen.getByText('1 other requests from this requester for this time'),
    ).toBeInTheDocument();
  });

  it('BKG-13 when another admin decided first, the server answers ALREADY_DECIDED and the page says so', async () => {
    mockApi({
      'GET /api/admin/room-requests?status=pending': ok(queue),
      'POST /api/room-requests/d2/decision': fail(409, 'ALREADY_DECIDED'),
    });
    render(wrap(<AdminRoomRequestsPage />));
    const row = (await screen.findByText('Make-up class')).closest('li');
    await userEvent.click(within(row).getByRole('button', { name: 'Approve' }));
    expect(
      await screen.findByText('Someone already decided this request. The list has been refreshed.'),
    ).toBeInTheDocument();
  });

  it('BKG-12 an empty queue says nothing is waiting', async () => {
    mockApi({ 'GET /api/admin/room-requests?status=pending': ok({ groups: [] }) });
    render(wrap(<AdminRoomRequestsPage />));
    expect(await screen.findByText('No requests are waiting for a decision.')).toBeInTheDocument();
  });
});

describe('ADM-06 the room requests card', () => {
  it('ADM-06 shows how many requests wait, with the first few and a link to the queue', () => {
    render(
      wrap(
        <RoomRequestsCard
          card={{
            count: 2,
            items: [
              {
                id: 'a',
                room_code: '311',
                date: '2027-04-07',
                start: 695,
                end: 750,
                requester_label: 'CSE 3-II-A',
              },
            ],
          }}
        />,
      ),
    );
    expect(screen.getByText('2 requests are waiting for a decision.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the room requests' })).toHaveAttribute(
      'href',
      '/admin/room-requests',
    );
  });

  it('ADM-06 with nothing waiting the card says so', () => {
    render(wrap(<RoomRequestsCard card={{ count: 0, items: [] }} />));
    expect(screen.getByText('No room requests are waiting.')).toBeInTheDocument();
  });
});
