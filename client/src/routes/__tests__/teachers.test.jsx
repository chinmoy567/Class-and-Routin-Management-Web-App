import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fail, meResponse, mockApi, ok, renderApp } from '@/test/mockApi.jsx';

afterEach(() => vi.unstubAllGlobals());

const cse = { id: 'd1', code: 'CSE', name: 'Computer Science', retired: false };

const adminMe = () =>
  ok({
    user: {
      id: 'me',
      full_name: 'Some Admin',
      kind: 'teacher',
      state: 'active',
      email_verified: true,
      email_bouncing: false,
    },
    roles: [{ role: 'dept_admin', department_id: 'd1' }],
    email_action_required: false,
    next: 'dashboard',
  });

const registration = {
  id: 'g1',
  user_id: 'u9',
  full_name: 'Abdur Rahman',
  email: 'ar@baiust.ac.bd',
  department_id: 'd1',
  department: { code: 'CSE', name: 'Computer Science' },
  requested_short_code: 'AR',
  status: 'pending',
  created_at: '2030-01-02T00:00:00Z',
  earlier_rejections: [{ reason: 'Wrong short code', requested_short_code: 'XX' }],
};

describe('teacher screens (spec 06)', () => {
  it('TCH-02 the admin sees the email, requested code and earlier rejections', async () => {
    mockApi({
      'GET /api/auth/me': adminMe(),
      'GET /api/departments': ok([cse]),
      'GET /api/admin/teacher-registrations?status=pending': ok([registration]),
      'GET /api/admin/teachers?department_id=d1': ok([]),
    });
    renderApp('/admin/teacher-registrations');
    expect(await screen.findByRole('heading', { level: 3, name: 'Abdur Rahman' })).toBeVisible();
    expect(screen.getByText('ar@baiust.ac.bd')).toBeInTheDocument();
    expect(screen.getByText('XX: Wrong short code')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Teacher registrations' })).toBeInTheDocument();
  });

  it('TCH-03 approving sends the decision', async () => {
    const calls = mockApi({
      'GET /api/auth/me': adminMe(),
      'GET /api/departments': ok([cse]),
      'GET /api/admin/teacher-registrations?status=pending': ok([registration]),
      'GET /api/admin/teachers?department_id=d1': ok([]),
      'POST /api/admin/teacher-registrations/g1/decision': ok({ id: 'g1', status: 'approved' }),
    });
    renderApp('/admin/teacher-registrations');
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    await vi.waitFor(() =>
      expect(calls.find((c) => c.url.endsWith('/g1/decision')).body).toEqual({
        id: undefined,
        decision: 'approve',
      }),
    );
  });

  it('TCH-04 rejecting shows the reason error from the server and a second admin sees ALREADY_DECIDED', async () => {
    const calls = mockApi({
      'GET /api/auth/me': adminMe(),
      'GET /api/departments': ok([cse]),
      'GET /api/admin/teacher-registrations?status=pending': ok([registration]),
      'GET /api/admin/teachers?department_id=d1': ok([]),
      'POST /api/admin/teacher-registrations/g1/decision': [
        fail(400, 'VALIDATION_ERROR', { fields: { reason: 'Enter at least 5 characters' } }),
        fail(409, 'ALREADY_DECIDED'),
      ],
    });
    renderApp('/admin/teacher-registrations');
    await userEvent.click(await screen.findByRole('button', { name: 'Reject' }));
    await userEvent.type(screen.getByLabelText('Reason for rejecting'), 'no');
    await userEvent.click(screen.getByRole('button', { name: 'Reject registration' }));
    expect(await screen.findByText('Enter 5 to 500 characters.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reject registration' }));
    expect(await screen.findByText('This was already decided.')).toBeInTheDocument();
    expect(calls.filter((c) => c.url.endsWith('/g1/decision'))).toHaveLength(2);
  });

  it('TCH-04 a rejected teacher sees the reason and TCH-05 can apply again', async () => {
    const calls = mockApi({
      'GET /api/auth/me': meResponse('teacher-rejected', { kind: 'teacher', state: 'pending' }),
      'GET /api/departments': ok([cse]),
      'GET /api/me/teacher-registration': ok({
        id: 'g1',
        status: 'rejected',
        reason: 'We have no teacher with that code',
        department_id: 'd1',
        requested_short_code: 'XX',
      }),
      'POST /api/me/teacher-registration': ok({ id: 'g2' }),
    });
    renderApp('/teacher-rejected');
    expect(await screen.findByText('We have no teacher with that code')).toBeInTheDocument();
    const code = screen.getByLabelText('Short code');
    await userEvent.clear(code);
    await userEvent.type(code, 'AR');
    await userEvent.click(screen.getByRole('button', { name: 'Apply again' }));
    await vi.waitFor(() =>
      expect(
        calls.find((c) => c.method === 'POST' && c.url === '/api/me/teacher-registration').body,
      ).toEqual({
        department_id: 'd1',
        short_code: 'AR',
      }),
    );
  });

  it('TCH-08 the Teachers page shows link status and a taken record gives a conflict message', async () => {
    mockApi({
      'GET /api/auth/me': adminMe(),
      'GET /api/departments': ok([cse]),
      'GET /api/admin/teachers?department_id=d1': ok([
        {
          id: 't1',
          department_id: 'd1',
          short_code: 'AR',
          full_name: 'Dr. A. Rahman',
          linked: false,
          linked_user: null,
        },
        {
          id: 't2',
          department_id: 'd1',
          short_code: 'BB',
          full_name: 'Dr. B. Bose',
          linked: true,
          linked_user: { id: 'u2', full_name: 'Bimal Bose', state: 'active' },
        },
      ]),
      'GET /api/admin/teacher-accounts?department_id=d1': ok([
        { id: 'u1', full_name: 'Abdur Rahman', state: 'active', linked: false },
        { id: 'u2', full_name: 'Bimal Bose', state: 'active', linked: true },
      ]),
      'POST /api/admin/teachers/t1/link': fail(409, 'CONFLICT'),
    });
    renderApp('/admin/teachers');
    expect(await screen.findByText('Linked to Bimal Bose')).toBeInTheDocument();
    expect(screen.getByText('Not linked')).toBeInTheDocument();
    await userEvent.selectOptions(
      await screen.findByLabelText('Teacher account', { selector: 'select' }),
      'u1',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Link' }));
    expect(await screen.findByText(/conflicts with something/)).toBeInTheDocument();
  });
});
