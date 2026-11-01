import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fail, mockApi, ok, renderApp } from '@/test/mockApi.jsx';

afterEach(() => vi.unstubAllGlobals());

const me = (roles, kind = 'staff') =>
  ok({
    user: {
      id: 'me',
      full_name: 'Some Admin',
      kind,
      state: 'active',
      email_verified: true,
      email_bouncing: false,
    },
    roles,
    email_action_required: false,
    next: 'dashboard',
  });

const cse = { id: 'd1', code: 'CSE', name: 'Computer Science', retired: false };
const eee = { id: 'd2', code: 'EEE', name: 'Electrical', retired: false };

const room = {
  id: 'r1',
  code: '311',
  type: 'classroom',
  retired: false,
  owner_department_id: 'd1',
  aliases: [{ id: 'a1', alias: 'RN: 311' }],
  shares: [{ department_id: 'd2', code: 'EEE', name: 'Electrical' }],
};

const deptAdmin = () => me([{ role: 'dept_admin', department_id: 'd1' }], 'teacher');

describe('classrooms screens (spec 05)', () => {
  it('ROOM-04 a department admin sees the Classrooms link, rooms with aliases and sharing, and the shared-with-me list', async () => {
    mockApi({
      'GET /api/auth/me': deptAdmin(),
      'GET /api/departments': ok([cse, eee]),
      'GET /api/admin/rooms?department_id=d1': ok({
        owned: [room],
        shared_with_me: [
          {
            id: 'r9',
            code: 'Physics Lab',
            type: 'lab',
            owner: { department_id: 'd2', code: 'EEE', name: 'Electrical' },
          },
        ],
      }),
    });
    renderApp('/admin/classrooms');
    expect(await screen.findByRole('heading', { level: 3, name: '311' })).toBeInTheDocument();
    expect(screen.getByText('RN: 311')).toBeInTheDocument();
    expect(screen.getByText('EEE')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Classrooms' })).toBeInTheDocument();
    const shared = screen.getByRole('region', { name: 'Shared with your department' });
    expect(within(shared).getByText('Physics Lab')).toBeInTheDocument();
    expect(within(shared).queryByRole('button')).not.toBeInTheDocument();
    // a department admin of one department gets no department picker
    expect(screen.queryByLabelText('Department')).not.toBeInTheDocument();
  });

  it('ROOM-01 a duplicate code shows the server error and sends the department', async () => {
    const calls = mockApi({
      'GET /api/auth/me': deptAdmin(),
      'GET /api/departments': ok([cse, eee]),
      'GET /api/admin/rooms?department_id=d1': ok({ owned: [], shared_with_me: [] }),
      'POST /api/admin/rooms': fail(409, 'CONFLICT'),
    });
    renderApp('/admin/classrooms');
    await userEvent.click(await screen.findByRole('button', { name: 'Add room' }));
    await userEvent.type(screen.getByLabelText('Room code'), '311');
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'lab');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText(/conflicts with something/)).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST' && c.url === '/api/admin/rooms').body).toEqual({
      code: '311',
      type: 'lab',
      department_id: 'd1',
    });
  });

  it('ROOM-02 an alias that is taken shows the server error', async () => {
    const calls = mockApi({
      'GET /api/auth/me': deptAdmin(),
      'GET /api/departments': ok([cse, eee]),
      'GET /api/admin/rooms?department_id=d1': ok({ owned: [room], shared_with_me: [] }),
      'POST /api/admin/rooms/r1/aliases': fail(409, 'CONFLICT'),
    });
    renderApp('/admin/classrooms');
    await userEvent.type(await screen.findByLabelText('New alias'), 'rn: 311');
    await userEvent.click(screen.getByRole('button', { name: 'Add alias' }));
    expect(await screen.findByText(/conflicts with something/)).toBeInTheDocument();
    expect(
      calls.find((c) => c.method === 'POST' && c.url === '/api/admin/rooms/r1/aliases').body,
    ).toEqual({ alias: 'rn: 311' });
  });

  it('ROOM-06 retiring a room that is in use shows the ROOM_IN_USE message', async () => {
    vi.stubGlobal('confirm', () => true);
    window.confirm = () => true;
    mockApi({
      'GET /api/auth/me': deptAdmin(),
      'GET /api/departments': ok([cse, eee]),
      'GET /api/admin/rooms?department_id=d1': ok({ owned: [room], shared_with_me: [] }),
      'POST /api/admin/rooms/r1/retire': fail(409, 'ROOM_IN_USE'),
    });
    renderApp('/admin/classrooms');
    await userEvent.click(await screen.findByRole('button', { name: 'Retire' }));
    expect(
      await screen.findByText(
        'A published class of the current or draft semester still uses this room.',
      ),
    ).toBeInTheDocument();
  });

  it('ROOM-04 the owner saves the sharing list', async () => {
    const calls = mockApi({
      'GET /api/auth/me': deptAdmin(),
      'GET /api/departments': ok([cse, eee]),
      'GET /api/admin/rooms?department_id=d1': ok({
        owned: [{ ...room, shares: [] }],
        shared_with_me: [],
      }),
      'PUT /api/admin/rooms/r1/shares': ok([]),
    });
    renderApp('/admin/classrooms');
    await userEvent.click(await screen.findByRole('button', { name: 'Change sharing' }));
    expect(screen.queryByLabelText(/CSE/)).not.toBeInTheDocument(); // the owner is not offered
    await userEvent.click(screen.getByLabelText(/EEE/));
    await userEvent.click(screen.getByRole('button', { name: 'Save sharing' }));
    await vi.waitFor(() =>
      expect(calls.some((c) => c.method === 'PUT' && c.url === '/api/admin/rooms/r1/shares')).toBe(
        true,
      ),
    );
    expect(calls.find((c) => c.method === 'PUT').body).toEqual({ department_ids: ['d2'] });
  });

  it('ROOM-01 a super admin picks the department', async () => {
    const calls = mockApi({
      'GET /api/auth/me': me([{ role: 'super_admin' }]),
      'GET /api/departments': ok([cse, eee]),
      'GET /api/admin/rooms?department_id=d1': ok({ owned: [], shared_with_me: [] }),
      'GET /api/admin/rooms?department_id=d2': ok({ owned: [], shared_with_me: [] }),
    });
    renderApp('/admin/classrooms');
    await userEvent.selectOptions(await screen.findByLabelText('Department'), 'd2');
    await vi.waitFor(() =>
      expect(calls.some((c) => c.url === '/api/admin/rooms?department_id=d2')).toBe(true),
    );
  });

  it('ROOM-08 a student gets no Classrooms page and no link', async () => {
    mockApi({ 'GET /api/auth/me': me([], 'student') });
    renderApp('/admin/classrooms');
    expect(await screen.findByRole('heading', { level: 1 })).not.toHaveTextContent('Classrooms');
    expect(screen.queryByRole('link', { name: 'Classrooms' })).not.toBeInTheDocument();
  });
});
