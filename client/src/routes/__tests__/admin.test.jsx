import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fail, mockApi, ok, renderApp } from '@/test/mockApi.jsx';

afterEach(() => vi.unstubAllGlobals());

const me = (roles) =>
  ok({
    user: {
      id: 'me',
      full_name: 'Root Admin',
      kind: 'staff',
      state: 'active',
      email_verified: true,
      email_bouncing: false,
    },
    roles,
    email_action_required: false,
    next: 'dashboard',
  });

const cse = { id: 'd1', code: 'CSE', name: 'Computer Science', retired: false };

describe('admin screens (spec 03)', () => {
  it('DEP-14 a department admin does not get the admin pages', async () => {
    mockApi({ 'GET /api/auth/me': me([{ role: 'dept_admin', department_id: 'd1' }]) });
    renderApp('/admin/admins');
    expect(await screen.findByRole('heading', { level: 1 })).not.toHaveTextContent('Admins');
    expect(screen.queryByRole('link', { name: 'Admins' })).not.toBeInTheDocument();
  });

  it('DEP-01 a super admin lists departments and sees the server error for a duplicate code', async () => {
    const calls = mockApi({
      'GET /api/auth/me': me([{ role: 'super_admin' }]),
      'GET /api/admin/departments': ok([cse]),
      'POST /api/admin/departments': fail(409, 'CONFLICT'),
    });
    renderApp('/admin/departments');
    expect(await screen.findByText('Computer Science')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add department' }));
    await userEvent.type(screen.getByLabelText('Code'), 'cse');
    await userEvent.type(screen.getByLabelText('Name'), 'Computer Science');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('conflicts');
    expect(
      calls.find((c) => c.method === 'POST' && c.url === '/api/admin/departments').body,
    ).toEqual({
      code: 'CSE',
      name: 'Computer Science',
    });
  });

  it('DEP-07 the admins page warns about fewer than two super admins and hides own actions', async () => {
    mockApi({
      'GET /api/auth/me': me([{ role: 'super_admin' }]),
      'GET /api/admin/admins': ok({
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
            roles: [{ id: 'r2', role: 'dept_admin', department: cse }],
          },
        ],
        super_admin_count: 1,
        fewer_than_two_super_admins: true,
      }),
      'GET /api/admin/departments': ok([cse]),
    });
    renderApp('/admin/admins');
    expect(await screen.findByText(/Fewer than two super admins/)).toBeInTheDocument();
    // only the other admin's row has remove and reset buttons
    expect(screen.getAllByRole('button', { name: 'Remove role' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Reset password' })).toHaveLength(1);
  });

  it('DEP-07 removing a role shows LAST_SUPER_ADMIN as a sentence', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockApi({
      'GET /api/auth/me': me([{ role: 'super_admin' }]),
      'GET /api/admin/admins': ok({
        admins: [
          {
            user_id: 'u2',
            full_name: 'Other Super',
            kind: 'staff',
            state: 'active',
            roles: [{ id: 'r2', role: 'super_admin', department: null }],
          },
        ],
        super_admin_count: 1,
        fewer_than_two_super_admins: true,
      }),
      'GET /api/admin/departments': ok([]),
      'DELETE /api/admin/admins/r2': fail(409, 'LAST_SUPER_ADMIN'),
    });
    renderApp('/admin/admins');
    await userEvent.click(await screen.findByRole('button', { name: 'Remove role' }));
    await waitFor(() =>
      expect(screen.getByText('The last super admin cannot be removed.')).toBeInTheDocument(),
    );
  });
});
