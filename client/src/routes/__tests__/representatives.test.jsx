import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fail, mockApi, ok, renderApp } from '@/test/mockApi.jsx';

vi.mock('@/lib/socket', () => ({
  connectSocket: () => ({ on: () => {}, off: () => {}, disconnect: () => {} }),
  disconnectSocket: () => {},
  onEvent: () => () => {},
}));

afterEach(() => vi.unstubAllGlobals());

const cse = { id: 'd1', code: 'CSE', name: 'Computer Science', retired: false };
const semester = { id: 's1', name: 'Fall 2026', status: 'current' };
const draft = { id: 's2', name: 'Spring 2027', status: 'draft' };

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
const adminMe = () => me([{ role: 'dept_admin', department_id: 'd1' }]);

const person = (id, name, role) => ({
  role_id: `r-${id}`,
  user_id: id,
  role,
  full_name: name,
  photo_url: null,
  state: 'active',
});
const detail = (over = {}) =>
  ok({
    section: { id: 'sec1', name: 'CSE 2-II-A', department_id: 'd1' },
    semester_status: 'current',
    representatives: [],
    last_semester: null,
    ...over,
  });

const base = (extra = {}) => ({
  'GET /api/auth/me': adminMe(),
  'GET /api/departments': ok([cse]),
  'GET /api/admin/semesters': ok([semester]),
  'GET /api/admin/semesters/s1/representatives/summary?department_id=d1': ok([
    { section_id: 'sec1', name: 'CSE 2-II-A', has_cr: false, dcr_count: 0 },
    { section_id: 'sec2', name: 'CSE 2-II-B', has_cr: true, dcr_count: 1 },
  ]),
  ...extra,
});

const openSection = async () =>
  userEvent.click(await screen.findByRole('button', { name: 'Open CSE 2-II-A' }));

describe('CR/DCR screen (spec 09)', () => {
  it('CRD-06 shows sections without a CR in the readiness hint and filled and empty slots', async () => {
    mockApi(
      base({
        'GET /api/admin/sections/sec1/representatives': detail({
          representatives: [person('u1', 'Cara CR', 'cr')],
        }),
      }),
    );
    renderApp('/admin/representatives');
    expect(await screen.findByText(/1 sections have no CR yet/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'CR / DCR' })).toBeInTheDocument();
    await openSection();
    const items = await screen.findAllByRole('listitem');
    const slots = items.filter((li) => li.dataset.role);
    expect(slots).toHaveLength(3);
    expect(within(slots[0]).getByText('Cara CR')).toBeVisible();
    expect(within(slots[0]).getByRole('button', { name: /Remove/ })).toBeInTheDocument();
    expect(within(slots[1]).getByText('Empty')).toBeVisible();
  });

  it('CRD-05 a draft section shows the "not in effect" note', async () => {
    mockApi(
      base({
        'GET /api/admin/semesters': ok([draft]),
        'GET /api/admin/semesters/s2/representatives/summary?department_id=d1': ok([
          { section_id: 'sec1', name: 'CSE 2-II-A', has_cr: false, dcr_count: 0 },
        ]),
        'GET /api/admin/sections/sec1/representatives': detail({ semester_status: 'draft' }),
      }),
    );
    renderApp('/admin/representatives');
    await openSection();
    expect(
      await screen.findByText('Not in effect until this semester becomes current.'),
    ).toBeVisible();
  });

  it('CRD-01/02 the search dialog assigns a student, and ROLE_LIMIT shows the CR message', async () => {
    const calls = mockApi(
      base({
        'GET /api/admin/sections/sec1/representatives': detail(),
        'GET /api/admin/students/search?q=ra&department_id=d1': ok([
          {
            id: 'u9',
            full_name: 'Rafi Ahmed',
            photo_url: null,
            uv_id: null,
            state: 'claim_pending',
          },
        ]),
        'POST /api/admin/sections/sec1/representatives': [
          fail(409, 'ROLE_LIMIT'),
          ok({ role_id: 'r1' }),
        ],
      }),
    );
    renderApp('/admin/representatives');
    await openSection();
    await userEvent.click(await screen.findByRole('button', { name: 'Assign CR' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Search students by name'), 'ra');
    await userEvent.click(await within(dialog).findByRole('button', { name: /Rafi Ahmed/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    expect(await within(dialog).findByText('This section already has a CR.')).toBeVisible();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts[0].body).toEqual({ user_id: 'u9', role: 'cr' });
    expect(posts).toHaveLength(2);
  });

  it('CRD-03 and CRD-01 server errors are shown in plain words', async () => {
    mockApi(
      base({
        'GET /api/admin/sections/sec1/representatives': detail(),
        'GET /api/admin/students/search?q=ra&department_id=d1': ok([
          { id: 'u9', full_name: 'Rafi Ahmed', photo_url: null, uv_id: null, state: 'active' },
        ]),
        'POST /api/admin/sections/sec1/representatives': [
          fail(409, 'CONFLICT'),
          fail(422, 'USER_NOT_ELIGIBLE'),
        ],
      }),
    );
    renderApp('/admin/representatives');
    await openSection();
    await userEvent.click(await (await screen.findAllByRole('button', { name: 'Assign DCR' }))[0]);
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Search students by name'), 'ra');
    await userEvent.click(await within(dialog).findByRole('button', { name: /Rafi Ahmed/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    expect(await within(dialog).findByText(/already has a CR or DCR role/)).toBeVisible();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    expect(await within(dialog).findByText(/cannot be CR or DCR/)).toBeVisible();
  });

  it('CRD-07 re-appoint shows the assigned and the skipped people with a reason', async () => {
    const calls = mockApi(
      base({
        'GET /api/admin/sections/sec1/representatives': detail({
          semester_status: 'draft',
          last_semester: {
            section: { id: 'old', name: 'CSE 2-I-A', label: '2-I-A' },
            semester: 'Fall 2026',
            representatives: [person('u1', 'Cara CR', 'cr'), person('u2', 'Gina Grad', 'dcr')],
          },
        }),
        'POST /api/admin/sections/sec1/representatives/reappoint': ok({
          assigned: [{ user_id: 'u1', full_name: 'Cara CR', role: 'cr', role_id: 'r1' }],
          skipped: [
            { user_id: 'u2', full_name: 'Gina Grad', role: 'dcr', reason: 'USER_NOT_ELIGIBLE' },
          ],
        }),
      }),
    );
    renderApp('/admin/representatives');
    await openSection();
    expect(await screen.findByText('Last semester (Fall 2026)')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Re-appoint' }));
    expect(await screen.findByText(/Gina Grad \(DCR\): Not eligible any more/)).toBeVisible();
    expect(screen.getByText('Cara CR (CR)')).toBeVisible();
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/reappoint'))).toBe(true);
  });

  it('CRD-08 removing asks first, then sends the request', async () => {
    const calls = mockApi(
      base({
        'GET /api/admin/sections/sec1/representatives': detail({
          representatives: [person('u1', 'Cara CR', 'cr')],
        }),
        'DELETE /api/admin/representatives/r-u1': ok(null),
      }),
    );
    renderApp('/admin/representatives');
    await openSection();
    await userEvent.click(await screen.findByRole('button', { name: /Remove/ }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Remove Cara CR as CR?')).toBeVisible();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
  });

  it('a student cannot reach the screen', async () => {
    mockApi({
      'GET /api/auth/me': me([], 'student'),
      'GET /api/departments': ok([cse]),
    });
    renderApp('/admin/representatives');
    await waitFor(() => expect(screen.queryByText('CR and DCR')).toBeNull());
    expect(screen.queryByRole('link', { name: 'CR / DCR' })).toBeNull();
  });

  it('CRD-09 the owner sees the role on their profile', async () => {
    mockApi({
      'GET /api/auth/me': me([{ role: 'cr', section_id: 'sec1', semester_id: 's1' }], 'student'),
      'GET /api/me/profile': ok({
        id: 'me',
        full_name: 'Cara CR',
        email: 'cara@baiust.ac.bd',
        phone: null,
        kind: 'student',
        state: 'active',
        email_bouncing: false,
        photo: { url: null, status: 'none' },
        roles: [{ role: 'cr', section_id: 'sec1', semester_id: 's1', label: 'cr' }],
        representative: {
          role: 'cr',
          section_id: 'sec1',
          section_name: 'CSE 2-II-A',
          semester_name: 'Fall 2026',
        },
        student: {
          department_id: null,
          level: null,
          term: null,
          section: null,
          group: null,
          confirmed_semester: null,
        },
      }),
    });
    renderApp('/profile');
    expect(await screen.findByText('CR of CSE 2-II-A · Fall 2026')).toBeVisible();
  });
});
