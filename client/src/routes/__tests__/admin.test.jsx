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
    expect(await screen.findByText(/conflicts with something/)).toBeInTheDocument();
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

describe('semesters screens (spec 04)', () => {
  const spring = {
    id: 's1',
    name: 'Spring 2027',
    status: 'draft',
    start_date: '2027-04-04',
    end_date: '2027-09-30',
    made_current_at: null,
  };

  it('SEM-06 a department admin does not get the semesters page or its link', async () => {
    mockApi({ 'GET /api/auth/me': me([{ role: 'dept_admin', department_id: 'd1' }]) });
    renderApp('/admin/semesters');
    expect(await screen.findByRole('heading', { level: 1 })).not.toHaveTextContent('Semesters');
    expect(screen.queryByRole('link', { name: 'Semesters' })).not.toBeInTheDocument();
  });

  it('SEM-01 a super admin creates a draft and sees the server error for a second one', async () => {
    const calls = mockApi({
      'GET /api/auth/me': me([{ role: 'super_admin' }]),
      'GET /api/admin/semesters': ok([]),
      'POST /api/admin/semesters': fail(409, 'CONFLICT'),
    });
    renderApp('/admin/semesters');
    await userEvent.click(await screen.findByRole('button', { name: 'Create draft semester' }));
    await userEvent.type(screen.getByLabelText('Name'), 'Spring 2027');
    await userEvent.type(screen.getByLabelText('Start date'), '2027-04-04');
    await userEvent.type(screen.getByLabelText('End date'), '2027-09-30');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText(/conflicts with something/)).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST' && c.url === '/api/admin/semesters').body).toEqual(
      { name: 'Spring 2027', start_date: '2027-04-04', end_date: '2027-09-30' },
    );
  });

  it('SEM-03 the server message for an end date before the start date is shown at the field', async () => {
    mockApi({
      'GET /api/auth/me': me([{ role: 'super_admin' }]),
      'GET /api/admin/semesters': ok([spring]),
      'PATCH /api/admin/semesters/s1': fail(400, 'VALIDATION_ERROR', {
        fields: { end_date: 'x' },
      }),
    });
    renderApp('/admin/semesters');
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText('The end date must be after the start date.'),
    ).toBeInTheDocument();
  });

  it('SEM-07 the first draft offers "Make current"; once a semester was current it does not', async () => {
    mockApi({
      'GET /api/auth/me': me([{ role: 'super_admin' }]),
      'GET /api/admin/semesters': ok([spring]),
    });
    renderApp('/admin/semesters');
    expect(await screen.findByRole('button', { name: 'Make current' })).toBeInTheDocument();
  });

  it('SEM-07 no "Make current" button after an earlier semester was current', async () => {
    mockApi({
      'GET /api/auth/me': me([{ role: 'super_admin' }]),
      'GET /api/admin/semesters': ok([
        spring,
        { ...spring, id: 's0', name: 'Fall 2026', status: 'archived', made_current_at: 'x' },
      ]),
    });
    renderApp('/admin/semesters');
    expect(await screen.findByText('Fall 2026')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Make current' })).not.toBeInTheDocument();
  });

  it('SEM-04 the server refusal to delete a draft in use is shown', async () => {
    vi.stubGlobal('confirm', () => true);
    mockApi({
      'GET /api/auth/me': me([{ role: 'super_admin' }]),
      'GET /api/admin/semesters': ok([spring]),
      'DELETE /api/admin/semesters/s1': fail(409, 'SEMESTER_IN_USE'),
    });
    renderApp('/admin/semesters');
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(
      await screen.findByText('Only an empty draft semester can be deleted.'),
    ).toBeInTheDocument();
  });

  it('SEM-01 the header shows the current semester name', async () => {
    mockApi({
      'GET /api/auth/me': me([]),
      'GET /api/semesters/current': ok({
        name: 'Spring 2027',
        start_date: '2027-04-04',
        end_date: '2027-09-30',
      }),
    });
    renderApp('/');
    expect((await screen.findAllByText('Spring 2027')).length).toBeGreaterThan(0);
  });
});
