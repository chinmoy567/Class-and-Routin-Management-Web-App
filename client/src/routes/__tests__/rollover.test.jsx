import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fail, meResponse, mockApi, ok, renderApp } from '@/test/mockApi.jsx';

vi.mock('@/lib/socket', () => ({
  connectSocket: () => ({ on: () => {}, off: () => {}, disconnect: () => {} }),
  disconnectSocket: () => {},
  onEvent: () => () => {},
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const admin = (roles) =>
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

const draft = [
  {
    id: 's2',
    name: 'Spring 2027',
    status: 'draft',
    start_date: '2027-01-10',
    end_date: '2027-06-30',
  },
];

const readiness = (canMake) => ({
  semester: { id: 's2', name: 'Spring 2027', status: 'draft' },
  can_make_current: canMake,
  departments: [
    {
      id: 'd1',
      code: 'CSE',
      name: 'Computer Science',
      ready: true,
      reasons: [],
      items: {
        sections: { ok: true, count: 2 },
        import: { ok: true },
        cr: { ok: true, total: 2, without_cr: 0 },
        rooms: { ok: true, count: 3 },
      },
    },
    {
      id: 'd2',
      code: 'EEE',
      name: 'Electrical',
      ready: false,
      reasons: ['no_import'],
      items: {
        sections: { ok: true, count: 1 },
        import: { ok: false },
        cr: { ok: true, total: 1, without_cr: 0 },
        rooms: { ok: true, count: 1 },
      },
    },
  ],
});

const makeCurrentDone = {
  id: 's2',
  name: 'Spring 2027',
  status: 'current',
  archived_semester_id: 's1',
  students_unconfirmed: 4,
  roles_ended: 1,
  roles_started: 1,
  roles_skipped: 0,
  requests_withdrawn: 0,
};

describe('the rollover page (spec 14, ROL-01 to ROL-03)', () => {
  it('ROL-01 each department shows its four checks and whether it is ready', async () => {
    mockApi({
      'GET /api/auth/me': admin([{ role: 'super_admin' }]),
      'GET /api/admin/semesters': ok(draft),
      'GET /api/admin/semesters/s2/readiness': ok(readiness(true)),
    });
    renderApp('/admin/rollover');
    expect(await screen.findByRole('heading', { name: 'Semester rollover' })).toBeVisible();
    expect(screen.getByRole('heading', { name: /CSE Computer Science/ })).toBeVisible();
    expect(screen.getByText('Ready')).toBeVisible();
    expect(screen.getByText('Not ready')).toBeVisible();
    expect(screen.getByText('No published routine with zero errors')).toBeVisible();
  });

  it('ROL-03 a not-ready department needs a second confirmation, then the change is sent with it', async () => {
    const calls = mockApi({
      'GET /api/auth/me': admin([{ role: 'super_admin' }]),
      'GET /api/admin/semesters': ok(draft),
      'GET /api/admin/semesters/s2/readiness': ok(readiness(true)),
      'POST /api/admin/semesters/s2/make-current': [
        fail(409, 'NOT_READY_UNCONFIRMED', {
          departments: [{ code: 'EEE', reasons: ['no_import'] }],
        }),
        ok(makeCurrentDone),
      ],
    });
    renderApp('/admin/rollover');
    await userEvent.click(await screen.findByRole('button', { name: 'Make current' }));
    const warning = (await screen.findByText(/Some departments are not ready/)).closest(
      '[role="alert"]',
    );
    expect(warning).toHaveTextContent('EEE');
    expect(warning).toHaveTextContent('no published routine');
    await userEvent.click(screen.getByRole('button', { name: 'Make current anyway' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Spring 2027 is now the current semester. 4 students must complete their semester update.',
    );
    const sent = calls.filter((c) => c.method === 'POST' && c.url.includes('make-current'));
    expect(sent.map((c) => c.body)).toEqual([
      { confirm_not_ready: [] },
      { confirm_not_ready: ['EEE'] },
    ]);
  });

  it('ROL-02 a department admin sees the checklist but no Make current button', async () => {
    mockApi({
      'GET /api/auth/me': admin([{ role: 'dept_admin', department_id: 'd1' }]),
      'GET /api/admin/semesters': ok(draft),
      'GET /api/admin/semesters/s2/readiness': ok({
        ...readiness(false),
        departments: readiness(false).departments.slice(0, 1),
      }),
    });
    renderApp('/admin/rollover');
    expect(await screen.findByRole('heading', { name: /CSE/ })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Make current' })).not.toBeInTheDocument();
    expect(screen.getByText('Only the super admin can make a semester current.')).toBeVisible();
  });
});

const options = {
  semester: { id: 's1', name: 'Fall 2026' },
  departments: [
    {
      id: 'd1',
      code: 'CSE',
      name: 'Computer Science',
      setting_up: false,
      sections: [
        { id: 'sec2', label: '2-I-A', groups: [] },
        { id: 'sec3', label: '3-I-A', groups: [] },
      ],
    },
  ],
};

const update = (over = {}) =>
  ok({
    semester: { id: 's1', name: 'Fall 2026' },
    last_section: { level: 2, term: 'II', letter: 'A' },
    prefill: { department_id: 'd1', letter: 'A', level: 3, term: 'I' },
    can_graduate: false,
    not_enrolled: false,
    ...over,
  });

const unconfirmed = meResponse('semester-update', { state: 'unconfirmed' });

describe('the semester update screen (spec 14, ROL-08 to ROL-10)', () => {
  it('ROL-11 an unconfirmed student who opens My routine is held on the update screen', async () => {
    mockApi({
      'GET /api/auth/me': unconfirmed,
      'GET /api/me/semester-update': update(),
      'GET /api/join/options': ok(options),
      'GET /api/me/join-request': ok(null),
    });
    renderApp('/routine');
    expect(await screen.findByRole('heading', { name: 'Semester update' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: /routine/i })).not.toBeInTheDocument();
  });

  it("ROL-08 the join form is pre-filled with last semester's department and the suggested term", async () => {
    mockApi({
      'GET /api/auth/me': unconfirmed,
      'GET /api/me/semester-update': update(),
      'GET /api/join/options': ok(options),
      'GET /api/me/join-request': ok(null),
    });
    renderApp('/semester-update');
    expect(await screen.findByRole('heading', { name: 'Semester update' })).toBeVisible();
    expect(screen.getByLabelText('Department')).toHaveValue('d1');
    expect(screen.getByLabelText('Section')).toHaveValue('sec3');
  });

  it('ROL-09 "I have completed my degree" is offered only after 4-II', async () => {
    mockApi({
      'GET /api/auth/me': unconfirmed,
      'GET /api/me/semester-update': update({ can_graduate: false }),
      'GET /api/join/options': ok(options),
      'GET /api/me/join-request': ok(null),
    });
    renderApp('/semester-update');
    await screen.findByRole('heading', { name: 'Semester update' });
    expect(
      screen.queryByRole('button', { name: 'I have completed my degree' }),
    ).not.toBeInTheDocument();
  });

  it('ROL-09 a 4-II student who confirms the choice is sent to graduate', async () => {
    const calls = mockApi({
      'GET /api/auth/me': unconfirmed,
      'GET /api/me/semester-update': update({ can_graduate: true }),
      'GET /api/join/options': ok(options),
      'GET /api/me/join-request': ok(null),
      'POST /api/me/graduate': ok({ state: 'graduated' }),
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderApp('/semester-update');
    await userEvent.click(
      await screen.findByRole('button', { name: 'I have completed my degree' }),
    );
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/me/graduate')).toBe(true);
  });

  it('ROL-10 "Not enrolled this semester" is sent after confirmation', async () => {
    const calls = mockApi({
      'GET /api/auth/me': unconfirmed,
      'GET /api/me/semester-update': update(),
      'GET /api/join/options': ok(options),
      'GET /api/me/join-request': ok(null),
      'POST /api/me/not-enrolled': ok({ not_enrolled_semester_id: 's1' }),
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderApp('/semester-update');
    await userEvent.click(
      await screen.findByRole('button', { name: 'Not enrolled this semester' }),
    );
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/me/not-enrolled')).toBe(true);
  });
});
