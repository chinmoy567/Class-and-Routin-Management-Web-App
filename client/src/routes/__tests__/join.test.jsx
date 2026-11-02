import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fail, meResponse, mockApi, ok, renderApp } from '@/test/mockApi.jsx';

vi.mock('@/lib/socket', () => ({
  connectSocket: () => ({ on: () => {}, off: () => {}, disconnect: () => {} }),
  disconnectSocket: () => {},
  onEvent: () => () => {},
}));

afterEach(() => vi.unstubAllGlobals());

const options = {
  semester: { id: 's1', name: 'Fall 2026' },
  departments: [
    {
      id: 'd1',
      code: 'CSE',
      name: 'Computer Science',
      setting_up: false,
      sections: [
        {
          id: 'sec1',
          label: '2-II-A',
          groups: [{ id: 'g1', label: 'G1' }],
        },
      ],
    },
    { id: 'd2', code: 'EEE', name: 'Electrical', setting_up: true, sections: [] },
  ],
};

const waitingRequest = (over = {}) => ({
  id: 'e1',
  status: 'pending',
  escalated: false,
  reason: null,
  appeal: null,
  section: { id: 'sec1', name: 'CSE 2-II-A' },
  uv_id: { text: '0822', status: 'pending' },
  representatives: [{ user_id: 'u9', role: 'cr', full_name: 'Cara CR', photo_url: null }],
  ...over,
});

describe('join form (spec 10)', () => {
  it('JR-03 a department with no open section shows "still setting up"', async () => {
    mockApi({
      'GET /api/auth/me': meResponse('join-form', { state: 'claim_pending' }),
      'GET /api/join/options': ok(options),
      'GET /api/me/join-request': ok(null),
    });
    renderApp('/join');
    await userEvent.selectOptions(await screen.findByLabelText('Department'), 'd2');
    expect(
      await screen.findByText('Your department is still setting up this semester.'),
    ).toBeVisible();
    expect(screen.queryByLabelText('Section')).not.toBeInTheDocument();
  });

  it('JR-01 sends the name, UV ID, section and group, then moves to the waiting screen', async () => {
    let sent = false;
    const calls = mockApi({
      'GET /api/auth/me': [
        meResponse('join-form', { state: 'claim_pending' }),
        meResponse('waiting-approval', { state: 'claim_pending' }),
      ],
      'GET /api/join/options': ok(options),
      'GET /api/me/join-request': () => ok(sent ? waitingRequest() : null),
      'POST /api/enrolments': () => {
        sent = true;
        return { ...ok({ id: 'e1', status: 'pending' }), status: 201 };
      },
    });
    renderApp('/join');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('UV ID'), '0822 3102');
    await user.selectOptions(screen.getByLabelText('Department'), 'd1');
    await user.selectOptions(await screen.findByLabelText('Section'), 'sec1');
    await user.selectOptions(await screen.findByLabelText('Lab group (optional)'), 'g1');
    await user.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByRole('heading', { name: 'Waiting for approval' })).toBeVisible();
    const post = calls.find((c) => c.method === 'POST' && c.url === '/api/enrolments');
    expect(post.body).toMatchObject({
      section_id: 'sec1',
      group_id: 'g1',
      uv_id: '0822 3102',
      full_name: 'Rafi Ahmed',
    });
  });

  it('JR-06 UV_ID_TAKEN and REQUEST_ALREADY_OPEN show a plain message', async () => {
    mockApi({
      'GET /api/auth/me': meResponse('join-form', { state: 'claim_pending' }),
      'GET /api/join/options': ok(options),
      'GET /api/me/join-request': ok(null),
      'POST /api/enrolments': fail(409, 'UV_ID_TAKEN'),
    });
    renderApp('/join');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('UV ID'), '123');
    await user.selectOptions(screen.getByLabelText('Department'), 'd1');
    await user.selectOptions(await screen.findByLabelText('Section'), 'sec1');
    await user.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'already approved for another account',
    );
  });

  it('JR-20 a rejected request shows the reason and a one-tap appeal; the UV ID is asked again', async () => {
    const calls = mockApi({
      'GET /api/auth/me': meResponse('join-form', { state: 'claim_pending' }),
      'GET /api/join/options': ok(options),
      'GET /api/me/join-request': [
        ok(
          waitingRequest({
            status: 'rejected',
            reason: 'Wrong batch',
            uv_id: { text: '1', status: 'rejected' },
          }),
        ),
        ok(
          waitingRequest({
            status: 'rejected',
            reason: 'Wrong batch',
            appeal: { status: 'open' },
            uv_id: { text: '1', status: 'rejected' },
          }),
        ),
      ],
      'POST /api/enrolments/e1/appeal': ok({ id: 'e1', appeal: { status: 'open' } }),
    });
    renderApp('/join');
    expect(await screen.findByText('Wrong batch')).toBeVisible();
    expect(screen.getByLabelText('UV ID')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ask the admin to review' }));
    expect(await screen.findByText('Your appeal was sent to the admin.')).toBeVisible();
    expect(calls.some((c) => c.url === '/api/enrolments/e1/appeal')).toBe(true);
  });
});

describe('waiting screen (JR-21)', () => {
  it('JR-21 shows the CR card and withdraws the request', async () => {
    const calls = mockApi({
      'GET /api/auth/me': [
        meResponse('waiting-approval', { state: 'claim_pending' }),
        meResponse('join-form', { state: 'claim_pending' }),
      ],
      'GET /api/me/join-request': [ok(waitingRequest()), ok(null)],
      'GET /api/join/options': ok(options),
      'POST /api/enrolments/e1/withdraw': ok({ id: 'e1', status: 'withdrawn' }),
    });
    renderApp('/waiting-approval');
    expect(
      await screen.findByText(
        /CSE 2-II-A is waiting for your CR or DCR|waiting for your CR or DCR/,
      ),
    ).toBeVisible();
    expect(screen.getByText('Cara CR')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Withdraw request' }));
    await waitFor(() =>
      expect(calls.some((c) => c.url === '/api/enrolments/e1/withdraw')).toBe(true),
    );
    expect(await screen.findByLabelText('UV ID')).toBeVisible();
  });

  it('JR-14 an escalated request says it is with the admin', async () => {
    mockApi({
      'GET /api/auth/me': meResponse('waiting-approval', { state: 'claim_pending' }),
      'GET /api/me/join-request': ok(waitingRequest({ escalated: true })),
    });
    renderApp('/waiting-approval');
    expect(await screen.findByText(/now with your department admin/)).toBeVisible();
  });
});
