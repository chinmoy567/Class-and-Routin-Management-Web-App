import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fail, mockApi, ok, renderApp } from '@/test/mockApi.jsx';

afterEach(() => vi.unstubAllGlobals());

const cse = { id: 'd1', code: 'CSE', name: 'Computer Science', retired: false };
const semester = { id: 's1', name: 'Spring 2030', status: 'current' };

const me = (roles) =>
  ok({
    user: {
      id: 'me',
      full_name: 'Some Admin',
      kind: 'teacher',
      state: 'active',
      email_verified: true,
      email_bouncing: false,
    },
    roles,
    email_action_required: false,
    next: 'dashboard',
  });
const adminMe = () => me([{ role: 'dept_admin', department_id: 'd1' }]);

const summary = (over = {}) => ({
  id: 'i1',
  semester_id: 's1',
  department_id: 'd1',
  status: 'checked',
  uploaded_by: { id: 'me', full_name: 'Some Admin' },
  uploaded_at: '2030-01-01T00:00:00Z',
  published_at: null,
  counts: { rows: 2, errors: 0, warnings: 0 },
  ...over,
});
const row = (n, over = {}) => ({
  row: n,
  section_key: 'CSE-4-I-A',
  group: null,
  day: 0,
  start_min: 540,
  end_min: 630,
  course_code: 'CSE-301',
  course_name: 'Algorithms',
  room_code: '311',
  teacher_keys: ['CSE:AA'],
  tba: false,
  combined_key: null,
  ...over,
});
const section = {
  key: 'CSE-4-I-A',
  department_code: 'CSE',
  level: 4,
  term: 'I',
  letter: 'A',
  new: true,
  groups: [],
  rows: [row(2), row(3, { day: 1 })],
};
const preview = (over = {}) => ({
  import: summary(),
  sections: [section],
  issues: [],
  teachers: [],
  diff: null,
  ...over,
});
const issue = (id, severity, message, extra = {}) => ({
  id,
  severity,
  code: 'x',
  row: 2,
  message,
  related_rows: [],
  ...extra,
});

const base = (extra = {}) => ({
  'GET /api/auth/me': adminMe(),
  'GET /api/departments': ok([cse]),
  'GET /api/admin/semesters': ok([semester]),
  'GET /api/semesters/s1/imports?department_id=d1': ok({
    imports: [summary()],
    open_import_id: 'i1',
  }),
  ...extra,
});

describe('routine import screen (spec 07)', () => {
  it('IMP-32 opens the department’s open import after a reload, with a preview per section', async () => {
    mockApi(base({ 'GET /api/imports/i1/preview': ok(preview()) }));
    renderApp('/admin/routine-import');
    expect(await screen.findByRole('heading', { level: 3, name: /CSE 4-I-A/ })).toBeVisible();
    expect(screen.getByText(/Sunday 09:00–10:30/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Routine import' })).toBeInTheDocument();
  });

  it('IMP-01 the template button asks for the department’s template', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    const calls = mockApi(base({ 'GET /api/imports/i1/preview': ok(preview()) }));
    const original = fetch;
    vi.stubGlobal('fetch', async (url, init) =>
      url.startsWith('/api/admin/imports/template')
        ? (calls.push({ method: 'GET', url }),
          { ok: true, blob: () => Promise.resolve(new Blob(['x'])) })
        : original(url, init),
    );
    renderApp('/admin/routine-import');
    await userEvent.click(await screen.findByRole('button', { name: 'Download template' }));
    await waitFor(() =>
      expect(calls.some((c) => c.url === '/api/admin/imports/template?department_id=d1')).toBe(
        true,
      ),
    );
  });

  it('IMP-02/03 uploading sends the file as the body; a wrong type shows the message', async () => {
    const calls = mockApi(
      base({
        'GET /api/imports/i1/preview': ok(preview()),
        'POST /api/semesters/s1/imports?department_id=d1': [
          fail(422, 'FILE_TYPE_NOT_ALLOWED'),
          ok(summary({ id: 'i2' })),
        ],
        'GET /api/imports/i2/preview': ok(preview({ import: summary({ id: 'i2' }) })),
      }),
    );
    renderApp('/admin/routine-import');
    const input = await screen.findByLabelText(/Excel file/);
    const file = new File(['x'], 'routine.xlsx');
    await userEvent.upload(input, file);
    await userEvent.click(screen.getByRole('button', { name: 'Upload and check' }));
    expect(await screen.findByText('Only an .xlsx file is accepted.')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Upload and check' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/imports/i2/preview')).toBe(true));
    const post = calls.filter((c) => c.method === 'POST' && c.url.includes('/imports?'));
    expect(post[1].body).toBe(file);
  });

  it('IMP-08..11 errors are listed and publishing is blocked', async () => {
    mockApi(
      base({
        'GET /api/imports/i1/preview': ok(
          preview({ issues: [issue('0', 'error', 'Unknown teacher CSE:AA')] }),
        ),
      }),
    );
    renderApp('/admin/routine-import');
    expect(await screen.findByText(/Unknown teacher CSE:AA/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument();
    expect(screen.getByText('Fix the errors and upload again to publish.')).toBeVisible();
  });

  it('IMP-12..15 the filter shows only warnings', async () => {
    mockApi(
      base({
        'GET /api/imports/i1/preview': ok(
          preview({
            issues: [
              issue('0', 'error', 'An error message'),
              issue('1', 'warning', 'A warning message'),
            ],
          }),
        ),
      }),
    );
    renderApp('/admin/routine-import');
    await screen.findByText(/An error message/);
    await userEvent.click(screen.getByRole('button', { name: 'Warnings' }));
    expect(screen.queryByText(/An error message/)).not.toBeInTheDocument();
    expect(screen.getByText(/A warning message/)).toBeVisible();
  });

  it('IMP-21 confirming a combined class calls the confirm endpoint', async () => {
    const calls = mockApi(
      base({
        'GET /api/imports/i1/preview': ok(
          preview({
            issues: [issue('0', 'warning', 'Same teacher and room', { offer_combined: true })],
          }),
        ),
        'POST /api/imports/i1/issues/0/confirm': ok({ combined_key: 'k' }),
      }),
    );
    renderApp('/admin/routine-import');
    await userEvent.click(await screen.findByRole('button', { name: 'Confirm combined class' }));
    await waitFor(() =>
      expect(calls.some((c) => c.url === '/api/imports/i1/issues/0/confirm')).toBe(true),
    );
  });

  it('IMP-24 a hand-edited slot is marked and choosing replace saves the choice', async () => {
    const calls = mockApi(
      base({
        'GET /api/imports/i1/preview': ok(
          preview({
            diff: {
              added: [],
              removed: [
                {
                  id: 'a1',
                  section_key: 'CSE-4-I-A',
                  group: null,
                  day: 2,
                  start_min: 600,
                  end_min: 690,
                  course_code: 'CSE-305',
                  teacher_keys: [],
                  edited_by_hand: true,
                  choice: 'keep',
                },
              ],
              changed: [],
            },
          }),
        ),
        'PUT /api/imports/i1/keep-choices': ok({ keep_choices: { a1: 'replace' } }),
      }),
    );
    renderApp('/admin/routine-import');
    expect(await screen.findByText(/edited by hand/)).toBeVisible();
    await userEvent.click(screen.getByRole('radio', { name: 'Replace it' }));
    await waitFor(() => {
      const put = calls.find((c) => c.method === 'PUT');
      expect(put.body).toEqual({ a1: 'replace' });
    });
  });

  it('IMP-25 publishing with warnings needs the review checkbox and sends it', async () => {
    const calls = mockApi(
      base({
        'GET /api/imports/i1/preview': ok(
          preview({ issues: [issue('0', 'warning', 'Teacher overlap')] }),
        ),
        'POST /api/imports/i1/publish': ok({ sections: 1 }),
      }),
    );
    renderApp('/admin/routine-import');
    await userEvent.click(await screen.findByRole('button', { name: 'Publish' }));
    const go = screen.getByRole('button', { name: 'Publish now' });
    expect(go).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: 'I have reviewed 1 warnings' }));
    await userEvent.click(go);
    expect(await screen.findByText('The routine was published.')).toBeVisible();
    expect(calls.find((c) => c.url === '/api/imports/i1/publish').body).toEqual({
      warnings_reviewed: true,
    });
  });

  it('IMP-33 a publish that lost the race says it was already decided', async () => {
    mockApi(
      base({
        'GET /api/imports/i1/preview': ok(preview()),
        'POST /api/imports/i1/publish': fail(409, 'ALREADY_DECIDED'),
      }),
    );
    renderApp('/admin/routine-import');
    await userEvent.click(await screen.findByRole('button', { name: 'Publish' }));
    await userEvent.click(screen.getByRole('button', { name: 'Publish now' }));
    expect(await screen.findByText('This was already decided.')).toBeVisible();
  });

  it('a student does not get the page', async () => {
    mockApi({
      'GET /api/auth/me': me([]),
      'GET /api/departments': ok([cse]),
    });
    renderApp('/admin/routine-import');
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Routine import' })).not.toBeInTheDocument(),
    );
  });
});
