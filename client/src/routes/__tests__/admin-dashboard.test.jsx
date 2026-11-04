import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fail, mockApi, ok, renderApp } from '@/test/mockApi.jsx';

afterEach(() => vi.unstubAllGlobals());

const me = (roles, kind = 'staff', next = 'dashboard') =>
  ok({
    user: {
      id: 'me',
      full_name: 'Root Admin',
      kind,
      state: 'active',
      email_verified: true,
      email_bouncing: false,
    },
    roles,
    email_action_required: false,
    next,
  });

const empty = { count: 0, items: [] };
const dashboard = (over = {}) =>
  ok({
    scope: { all: false, department_id: null },
    released: { room_requests: false },
    teacher_registrations: empty,
    join_requests: empty,
    flags: empty,
    rejections_and_appeals: empty,
    routine_problems: empty,
    semester: { current: null, draft: null, readiness: null },
    unconfirmed: empty,
    recent_activity: empty,
    ...over,
  });

const cseAdmin = [{ role: 'dept_admin', department_id: 'd1' }];

describe('admin home (spec 18)', () => {
  it('ADM-08 a department admin does not see the departments-without-admin card', async () => {
    mockApi({
      'GET /api/auth/me': me(cseAdmin, 'teacher'),
      'GET /api/admin/dashboard': dashboard(),
    });
    renderApp('/admin');
    expect(await screen.findByRole('heading', { name: 'Admin home' })).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Departments without an active admin' }),
    ).not.toBeInTheDocument();
  });

  it('ADM-08 a super admin sees the departments-without-admin card and the two-admin warning', async () => {
    mockApi({
      'GET /api/auth/me': me([{ role: 'super_admin' }]),
      'GET /api/admin/dashboard': dashboard({
        missing_admin: {
          departments: { count: 1, items: [{ id: 'd2', code: 'EEE', name: 'Electrical' }] },
          super_admin_count: 1,
          fewer_than_two_super_admins: true,
        },
      }),
    });
    renderApp('/admin');
    expect(
      await screen.findByRole('heading', { name: 'Departments without an active admin' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Fewer than two super admins');
  });

  it('ADM-01 approving a registration sends the spec 06 decision, with no email on the card', async () => {
    const calls = mockApi({
      'GET /api/auth/me': me(cseAdmin, 'teacher'),
      'GET /api/admin/dashboard': dashboard({
        teacher_registrations: {
          count: 1,
          items: [
            {
              id: 'r1',
              full_name: 'Dr. Ayesha',
              department: { code: 'CSE' },
              requested_short_code: 'AYE',
            },
          ],
        },
      }),
      'POST /api/admin/teacher-registrations/r1/decision': ok({ id: 'r1' }),
    });
    renderApp('/admin');
    expect(await screen.findByText('Dr. Ayesha')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/@/);
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/r1/decision'))).toBe(true),
    );
  });
});

describe('students (spec 18)', () => {
  const rahim = {
    id: 's1',
    full_name: 'Rahim Uddin',
    photo_url: null,
    state: 'active',
    email_status: 'verified',
    uv_id: '0822310205101077',
    enrolment: { id: 'e1', status: 'accepted' },
    section: { id: 'sec1', label: '2-I-A' },
    group: null,
  };

  it('ADM-12 OS-07 search results show a name, the profile UV ID and email status, and no address or phone', async () => {
    mockApi({
      'GET /api/auth/me': me(cseAdmin, 'teacher'),
      'GET /api/admin/students?q=Rahim': ok([rahim]),
    });
    renderApp('/admin/students');
    await userEvent.type(await screen.findByRole('searchbox'), 'Rahim');
    expect(await screen.findByText('Rahim Uddin')).toBeInTheDocument();
    expect(screen.getByText('UV ID: 0822310205101077')).toBeInTheDocument();
    expect(screen.getByText(/Email verified/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/@|\+?880/);
  });

  it('ADM-13 deactivate needs a reason of at least 5 characters before its confirm button is enabled', async () => {
    const calls = mockApi({
      'GET /api/auth/me': me(cseAdmin, 'teacher'),
      'GET /api/admin/students?q=Rahim': ok([rahim]),
      'POST /api/admin/students/s1/deactivate': ok({ id: 's1', state: 'deactivated' }),
    });
    renderApp('/admin/students');
    await userEvent.type(await screen.findByRole('searchbox'), 'Rahim');
    await userEvent.click(await screen.findByRole('button', { name: 'Deactivate' }));
    const dialog = await screen.findByRole('alertdialog');
    const confirm = within(dialog).getByRole('button', { name: 'Deactivate' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByRole('textbox'), 'Left');
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByRole('textbox'), ' the course');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/deactivate'));
      expect(post.body).toEqual({ reason: 'Left the course' });
    });
  });

  it('ADM-15 a temporary password is shown once, and gone when the dialog closes', async () => {
    mockApi({
      'GET /api/auth/me': me(cseAdmin, 'teacher'),
      'GET /api/admin/students?q=Rahim': ok([rahim]),
      'POST /api/admin/students/s1/temp-password': ok({ temp_password: 'Kp7mQ2xT9bLa' }),
    });
    renderApp('/admin/students');
    await userEvent.type(await screen.findByRole('searchbox'), 'Rahim');
    await userEvent.click(await screen.findByRole('button', { name: 'Temporary password' }));
    expect(await screen.findByText('Kp7mQ2xT9bLa')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByText('Kp7mQ2xT9bLa')).not.toBeInTheDocument());
  });

  it('ADM-21 OS-11 removing a student from a section asks for a reason and a confirmation, then sends it', async () => {
    const calls = mockApi({
      'GET /api/auth/me': me(cseAdmin, 'teacher'),
      'GET /api/admin/students?q=Rahim': ok([rahim]),
      'POST /api/admin/enrolments/e1/remove': ok({ id: 'e1', status: 'revoked' }),
    });
    renderApp('/admin/students');
    await userEvent.type(await screen.findByRole('searchbox'), 'Rahim');
    expect(screen.queryByRole('button', { name: /Revoke UV ID/ })).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Remove from section' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('2-I-A');
    const confirm = within(dialog).getByRole('button', { name: 'Remove from section' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByRole('textbox'), 'Joined the wrong section');
    await userEvent.click(confirm);
    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/e1/remove'));
      expect(post.body).toEqual({ reason: 'Joined the wrong section' });
    });
  });

  it('OS-11 a student with no accepted membership has no remove control', async () => {
    mockApi({
      'GET /api/auth/me': me(cseAdmin, 'teacher'),
      'GET /api/admin/students?q=Rahim': ok([
        { ...rahim, enrolment: { id: 'e1', status: 'pending' }, section: null },
      ]),
    });
    renderApp('/admin/students');
    await userEvent.type(await screen.findByRole('searchbox'), 'Rahim');
    expect(await screen.findByText('Rahim Uddin')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove from section' })).not.toBeInTheDocument();
  });
});

describe('flags and audit (spec 18)', () => {
  it('ADM-18 a reply that is blank is refused on the screen, and nothing is sent', async () => {
    const calls = mockApi({
      'GET /api/auth/me': me(cseAdmin, 'teacher'),
      'GET /api/admin/flags?status=open': ok([
        {
          id: 'f1',
          status: 'open',
          category: 'wrong_group',
          description: 'A student is in the wrong group.',
          reply: null,
          department: { id: 'd1', code: 'CSE' },
          section: { id: 'sec1', label: '2-I-A' },
          student: null,
          raised_by: { id: 'u9', name: 'Shahin' },
          created_at: '2027-04-05T04:00:00Z',
        },
      ]),
    });
    renderApp('/admin/flags');
    await userEvent.click(await screen.findByRole('button', { name: 'Mark fixed' }));
    expect(await screen.findByText('Write a reply of 1 to 1,000 characters.')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('ADM-19 the audit log page has no edit or delete control', async () => {
    mockApi({
      'GET /api/auth/me': me(cseAdmin, 'teacher'),
      'GET /api/admin/audit': ok({
        entries: [
          {
            id: 'a1',
            at: '2027-04-05T04:00:00Z',
            action: 'student.deactivate',
            actor_id: 'u1',
            actor_name: 'CSE Admin',
            scope_department_id: 'd1',
            target: { type: 'user', id: 's1' },
            old_value: { state: 'active' },
            new_value: { state: 'deactivated' },
          },
        ],
        next_cursor: null,
      }),
    });
    renderApp('/admin/audit');
    expect(await screen.findByText('student.deactivate')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit|delete|remove/i })).not.toBeInTheDocument();
  });
});

describe('temporary password and staff landing (spec 18)', () => {
  it('ADM-15 a student who must change a temporary password is held on the change screen', async () => {
    mockApi({
      'GET /api/auth/me': me([], 'student', 'change-password'),
    });
    renderApp('/');
    expect(
      await screen.findByRole('heading', { name: 'Choose a new password' }),
    ).toBeInTheDocument();
  });

  it('ADM-15 the forced change shows the server message when the current password is wrong', async () => {
    mockApi({
      'GET /api/auth/me': me([], 'student', 'change-password'),
      'POST /api/me/password': fail(401, 'INVALID_CREDENTIALS'),
    });
    renderApp('/change-password');
    await userEvent.type(await screen.findByLabelText('Current password'), 'WrongOne1');
    await userEvent.type(screen.getByLabelText('New password'), 'a-new-password-3');
    await userEvent.click(screen.getByRole('button', { name: 'Save new password' }));
    expect(await screen.findByText(/not correct/)).toBeInTheDocument();
  });

  it('ADM-11 a staff admin with no teaching role lands on the admin home', async () => {
    mockApi({
      'GET /api/auth/me': me([{ role: 'super_admin' }], 'staff'),
      'GET /api/admin/dashboard': dashboard(),
    });
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Admin home' })).toBeInTheDocument();
  });
});

describe('ADM-21 destructive admin actions ask first (spec 18)', () => {
  const cseDept = { id: 'd1', code: 'CSE', name: 'Computer Science', retired: false };
  const adminsList = ok({
    admins: [
      {
        user_id: 'me',
        full_name: 'Root Admin',
        kind: 'staff',
        state: 'active',
        roles: [{ id: 'r1', role: 'super_admin', department: null }],
      },
      {
        user_id: 'u2',
        full_name: 'Dr Salma',
        kind: 'teacher',
        state: 'active',
        roles: [{ id: 'r2', role: 'dept_admin', department: cseDept }],
      },
    ],
    super_admin_count: 2,
    fewer_than_two_super_admins: false,
  });

  it('ADM-21 cancelling the remove-role confirmation sends nothing to the server', async () => {
    const calls = mockApi({
      'GET /api/auth/me': me([{ role: 'super_admin' }]),
      'GET /api/admin/admins': adminsList,
      'GET /api/admin/departments': ok([cseDept]),
      'DELETE /api/admin/admins/r2': ok({}),
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderApp('/admin/admins');
    await userEvent.click(await screen.findByRole('button', { name: 'Remove role' }));
    expect(confirm).toHaveBeenCalled();
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    confirm.mockRestore();
  });

  it('ADM-21 confirming the remove-role request sends the removal', async () => {
    const calls = mockApi({
      'GET /api/auth/me': me([{ role: 'super_admin' }]),
      'GET /api/admin/admins': adminsList,
      'GET /api/admin/departments': ok([cseDept]),
      'DELETE /api/admin/admins/r2': ok({}),
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderApp('/admin/admins');
    await userEvent.click(await screen.findByRole('button', { name: 'Remove role' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/admin/admins/r2')).toBe(
        true,
      ),
    );
    confirm.mockRestore();
  });
});

describe('ADM-16 appeals from the admin home (spec 18)', () => {
  it('ADM-16 accepting an open appeal calls the spec 10 appeal decision endpoint', async () => {
    const calls = mockApi({
      'GET /api/auth/me': me(cseAdmin, 'teacher'),
      'GET /api/admin/dashboard': dashboard({
        rejections_and_appeals: {
          count: 1,
          items: [
            {
              kind: 'appeal',
              id: 'e9',
              full_name: 'Mina Begum',
              department: { code: 'CSE' },
              section: null,
              reason: 'Wrong section',
              created_at: '2027-04-05T04:00:00Z',
            },
          ],
        },
      }),
      'POST /api/admin/enrolments/e9/appeal-decision': ok({ id: 'e9' }),
    });
    renderApp('/admin');
    await userEvent.click(await screen.findByRole('button', { name: 'Accept the request' }));
    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/e9/appeal-decision'));
      expect(post?.body).toEqual({ decision: 'reverse' });
    });
  });
});
