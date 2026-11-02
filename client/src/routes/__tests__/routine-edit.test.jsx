import { describe, it, expect, afterEach, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fail, mockApi, ok, renderApp } from '@/test/mockApi.jsx';

vi.mock('@/lib/socket', () => ({
  connectSocket: () => ({ on: () => {}, off: () => {}, disconnect: () => {} }),
  disconnectSocket: () => {},
  onEvent: () => () => {},
}));

afterEach(() => vi.unstubAllGlobals());

const cse = { id: 'd1', code: 'CSE', name: 'Computer Science', retired: false };
const semester = { id: 's1', name: 'Spring 2030', status: 'current' };

const me = (roles, kind = 'teacher') =>
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

const slot = (id, over = {}) => ({
  id,
  group: null,
  day_of_week: 0,
  start: '09:00',
  end: '10:00',
  course_code: 'CSE-301',
  course_name: 'Algorithms',
  room: '311',
  teachers: ['Ab Bar'],
  owner_department: { id: 'd1', code: 'CSE' },
  editable: true,
  version: 1,
  combined: false,
  edited_by_hand: false,
  ...over,
});
const grid = (slots, over = {}) =>
  ok({
    section: {
      id: 'sec1',
      semester_id: 's1',
      semester_status: 'current',
      department_id: 'd1',
      level: 4,
      term: 'I',
      letter: 'A',
      groups: [{ id: 'g1', label: 'G1' }],
      can_manage: true,
      ...over,
    },
    slots,
  });

const base = (extra = {}) => ({
  'GET /api/auth/me': adminMe(),
  'GET /api/departments': ok([cse]),
  'GET /api/admin/semesters': ok([semester]),
  'GET /api/admin/semesters/s1/sections': ok([
    {
      id: 'sec1',
      department_id: 'd1',
      department_code: 'CSE',
      level: 4,
      term: 'I',
      letter: 'A',
      name: 'CSE 4-I-A',
      groups: [{ id: 'g1', label: 'G1' }],
      can_manage: true,
    },
  ]),
  ...extra,
});

const fill = async () => {
  await userEvent.click(await screen.findByRole('button', { name: 'Add a class' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Start'), { target: { value: '11:00' } });
  fireEvent.change(within(dialog).getByLabelText('End'), { target: { value: '12:00' } });
  await userEvent.type(within(dialog).getByLabelText('Course code'), 'CSE-302');
  await userEvent.type(within(dialog).getByLabelText(/^Teachers/), 'CSE:AB');
  await userEvent.type(within(dialog).getByLabelText('Room'), '999');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
  return dialog;
};

describe('routine edit screen (spec 08)', () => {
  it('EDT-01 other departments’ slots are greyed out with the owner code and have no buttons', async () => {
    mockApi(
      base({
        'GET /api/admin/sections/sec1/routine': grid([
          slot('a'),
          slot('b', {
            course_code: 'LAW-101',
            owner_department: { id: 'd2', code: 'LAW' },
            editable: false,
            day_of_week: 1,
          }),
        ]),
      }),
    );
    renderApp('/admin/routine-edit');
    expect(await screen.findByText('Owned by LAW · Read only')).toBeVisible();
    const cards = screen.getAllByRole('listitem').filter((li) => li.dataset.editable);
    const law = cards.find((li) => li.dataset.editable === 'false');
    expect(within(law).queryByRole('button')).toBeNull();
    const mine = cards.find((li) => li.dataset.editable === 'true');
    expect(within(mine).getByRole('button', { name: /Edit/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Routine edit' })).toBeInTheDocument();
  });

  it('EDT-04 a SLOT_INVALID answer is listed inside the dialog', async () => {
    mockApi(
      base({
        'GET /api/admin/sections/sec1/routine': grid([]),
        'POST /api/slots': fail(400, 'SLOT_INVALID', {
          issues: [{ severity: 'error', code: 'UNKNOWN_ROOM', message: 'Unknown room "999".' }],
        }),
      }),
    );
    renderApp('/admin/routine-edit');
    const dialog = await fill();
    expect(await within(dialog).findByText('Unknown room "999".')).toBeVisible();
  });

  it('EDT-04 warnings show as a second step, and confirming re-sends with confirm_warnings', async () => {
    const calls = mockApi(
      base({
        'GET /api/admin/sections/sec1/routine': grid([]),
        'POST /api/slots': [
          ok({
            saved: false,
            warnings: [
              { severity: 'warning', code: 'TEACHER_OVERLAP', message: 'CSE:AB has two classes.' },
            ],
          }),
          ok({ saved: true, slot: {} }),
        ],
      }),
    );
    renderApp('/admin/routine-edit');
    await fill();
    expect(await screen.findByText('CSE:AB has two classes.')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Save anyway' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const posts = calls.filter((c) => c.method === 'POST' && c.url === '/api/slots');
    expect(posts).toHaveLength(2);
    expect(posts[0].body.confirm_warnings).toBeUndefined();
    expect(posts[1].body).toMatchObject({
      confirm_warnings: true,
      course_code: 'CSE-302',
      teachers: ['CSE:AB'],
    });
  });

  it('EDT-09 a 409 closes the dialog, shows the notice and reloads the section', async () => {
    const calls = mockApi(
      base({
        'GET /api/admin/sections/sec1/routine': [
          grid([slot('a')]),
          grid([slot('a', { version: 2 })]),
        ],
        'PUT /api/slots/a': fail(409, 'CONFLICT'),
      }),
    );
    renderApp('/admin/routine-edit');
    await userEvent.click(await screen.findByRole('button', { name: /Edit/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Start'), { target: { value: '09:00' } });
    await userEvent.type(within(dialog).getByLabelText(/^Teachers/), 'CSE:AB');
    await userEvent.type(
      within(dialog).getByLabelText('Room'),
      '{backspace}{backspace}{backspace}311',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/Someone else changed this class/)).toBeVisible();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const reloads = calls.filter((c) => c.url === '/api/admin/sections/sec1/routine');
    expect(reloads.length).toBeGreaterThanOrEqual(2);
    const put = calls.find((c) => c.method === 'PUT');
    expect(put.body.version).toBe(1);
  });

  it('EDT-07 removing a group that is in use shows the translated message', async () => {
    mockApi(
      base({
        'GET /api/admin/sections/sec1/routine': grid([]),
        'DELETE /api/admin/groups/g1': fail(409, 'GROUP_IN_USE'),
      }),
    );
    renderApp('/admin/routine-edit');
    await userEvent.click(await screen.findByRole('button', { name: 'Remove G1' }));
    expect(await screen.findByText('A class or a student still uses this group.')).toBeVisible();
  });

  it('EDT-10 a student never gets the page or the link', async () => {
    mockApi({
      'GET /api/auth/me': me([], 'student'),
      'GET /api/departments': ok([cse]),
    });
    renderApp('/admin/routine-edit');
    await screen.findByRole('navigation');
    expect(screen.queryByRole('heading', { name: 'Routine edit' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Routine edit' })).toBeNull();
  });
});
