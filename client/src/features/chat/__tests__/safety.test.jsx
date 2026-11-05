// Spec 22: the report, block, suspension and admin safety screens. Requirement IDs in the names.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { mockApi, ok, fail, meResponse } from '@/test/mockApi.jsx';
import { ReportDialog } from '../components/ReportDialog.jsx';
import { BlockControl } from '../components/BlockControl.jsx';
import { SuspensionBanner } from '../components/SuspensionBanner.jsx';
import { SuspendDialog } from '../components/SuspendDialog.jsx';
import { BlockedUsersPage } from '@/routes/BlockedUsersPage.jsx';
import { AdminReportsPage } from '@/routes/admin/AdminReportsPage.jsx';

vi.mock('@/lib/socket', () => ({ onEvent: () => () => {} }));

afterEach(() => vi.unstubAllGlobals());

const wrap = (ui) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );

const future = () => new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

describe('SAF-04: the report dialog', () => {
  it('SAF-04 the report needs a reason; the note is sent only when written; the reporter sees a thank-you', async () => {
    const calls = mockApi({ 'POST /api/chat/reports': ok({ id: 'r1' }) });
    const onClose = vi.fn();
    wrap(<ReportDialog targetUserId="u9" targetName="Nusrat Jahan" onClose={onClose} />);

    const submit = screen.getByRole('button', { name: 'Send report' });
    expect(submit).toBeDisabled();
    await userEvent.click(screen.getByRole('radio', { name: 'Spam' }));
    expect(submit).toBeEnabled();
    await userEvent.click(submit);

    expect(await screen.findByText(/Thank you/)).toBeInTheDocument();
    const sent = calls.find((c) => c.url === '/api/chat/reports');
    expect(sent.body).toEqual({ target_user_id: 'u9', category: 'spam' });
  });

  it('SAF-04 a note is sent with the report when it is written', async () => {
    const calls = mockApi({ 'POST /api/chat/reports': ok({ id: 'r2' }) });
    const onClose = vi.fn();
    wrap(<ReportDialog targetUserId="u9" targetName="N" messageId="m4" onClose={onClose} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Harassment' }));
    await userEvent.type(screen.getByRole('textbox'), 'keeps repeating this');
    await userEvent.click(screen.getByRole('button', { name: 'Send report' }));
    await screen.findByText(/Thank you/);
    expect(calls.find((c) => c.url === '/api/chat/reports').body).toEqual({
      target_user_id: 'u9',
      message_id: 'm4',
      category: 'harassment',
      note: 'keeps repeating this',
    });
  });

  it('SAF-04 Escape closes the report dialog before it is sent', async () => {
    const onClose = vi.fn();
    wrap(<ReportDialog targetUserId="u9" targetName="N" onClose={onClose} />);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('SAF-04 the server refusal (daily limit) shows on the form', async () => {
    mockApi({ 'POST /api/chat/reports': fail(429, 'RATE_LIMITED') });
    wrap(<ReportDialog targetUserId="u9" targetName="N" onClose={() => {}} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Spam' }));
    await userEvent.click(screen.getByRole('button', { name: 'Send report' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});

describe('SAF-01: block and unblock from a profile', () => {
  it('SAF-01 offers Block, then Unblock when the person is already blocked; names the person for screen readers', async () => {
    mockApi({
      'GET /api/chat/blocks': ok([{ user_id: 'u9', full_name: 'Nusrat Jahan', photo_url: null }]),
    });
    wrap(<BlockControl userId="u9" name="Nusrat Jahan" />);
    expect(await screen.findByRole('button', { name: 'Unblock Nusrat Jahan' })).toBeInTheDocument();
  });

  it('SAF-01 blocking sends POST /api/chat/blocks', async () => {
    const calls = mockApi({
      'GET /api/chat/blocks': ok([]),
      'POST /api/chat/blocks': ok({ blocked: true }),
    });
    wrap(<BlockControl userId="u9" name="Nusrat Jahan" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Block Nusrat Jahan' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST' && c.url === '/api/chat/blocks').body).toEqual({
        user_id: 'u9',
      }),
    );
  });
});

describe('SAF-01, SAF-04: the blocked people and my reports page', () => {
  it('SAF-01 unblock at any time from the blocked list; SAF-04 reports show open or reviewed only', async () => {
    const calls = mockApi({
      'GET /api/chat/blocks': ok([{ user_id: 'u9', full_name: 'Nusrat Jahan', photo_url: null }]),
      'DELETE /api/chat/blocks/u9': ok(null),
      'GET /api/chat/reports/mine': ok([
        {
          id: 'r1',
          category: 'spam',
          about_message: false,
          created_at: new Date().toISOString(),
          status: 'reviewed',
        },
        {
          id: 'r2',
          category: 'harassment',
          about_message: true,
          created_at: new Date().toISOString(),
          status: 'open',
        },
      ]),
    });
    wrap(<BlockedUsersPage />);
    expect(await screen.findByText('Reviewed')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Unblock Nusrat Jahan' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/chat/blocks/u9')).toBe(
        true,
      ),
    );
  });
});

describe('SAF-10: the suspension banner', () => {
  it('SAF-10 a suspended user is told the end time and that reading still works', async () => {
    mockApi({ 'GET /api/auth/me': meResponse(null, { chat_suspended_until: future() }) });
    wrap(<SuspensionBanner />);
    expect(await screen.findByText('Your chat is suspended')).toBeInTheDocument();
    expect(screen.getByText(/You can still read your chats/)).toBeInTheDocument();
  });

  it('SAF-10 no banner once the suspension has ended', async () => {
    mockApi({
      'GET /api/auth/me': meResponse(null, {
        chat_suspended_until: new Date(Date.now() - 1000).toISOString(),
      }),
    });
    wrap(<SuspensionBanner />);
    await waitFor(() => expect(screen.queryByText('Your chat is suspended')).toBeNull());
  });
});

describe('SAF-10: the admin suspend dialog', () => {
  it('SAF-10 suspends for the chosen length with a reason, and lifts a running one', async () => {
    const calls = mockApi({
      'GET /api/admin/chat/suspensions?user_id=u1': ok([
        { id: 's1', user_id: 'u1', until: future(), reason: 'old' },
      ]),
      'POST /api/admin/chat/suspensions': ok({ id: 's2', user_id: 'u1', until: future() }),
      'POST /api/admin/chat/suspensions/s1/lift': ok({ id: 's1', lifted: true }),
    });
    wrap(<SuspendDialog userId="u1" name="Rahim Ahmed" onClose={() => {}} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Lift suspension' }));
    await waitFor(() =>
      expect(calls.some((c) => c.url === '/api/admin/chat/suspensions/s1/lift')).toBe(true),
    );

    await userEvent.selectOptions(screen.getByRole('combobox'), '168');
    await userEvent.type(screen.getByRole('textbox'), 'Spam in the group');
    await userEvent.click(screen.getByRole('button', { name: 'Suspend from sending' }));
    await waitFor(() => {
      const made = calls.find(
        (c) => c.method === 'POST' && c.url === '/api/admin/chat/suspensions',
      );
      expect(made.body).toEqual({ user_id: 'u1', hours: 168, reason: 'Spam in the group' });
    });
  });
});

describe('SAF-05 to SAF-08: the admin reports page', () => {
  const report = {
    id: 'r1',
    category: 'harassment',
    status: 'open',
    outcome: null,
    note: 'rude messages',
    created_at: new Date().toISOString(),
    closed_at: null,
    target: { user_id: 'u9', full_name: 'Teacher T' },
    messages: [
      {
        id: 'm1',
        sender_name: 'Teacher T',
        created_at: new Date().toISOString(),
        deleted: false,
        reported: false,
        body: 'before',
      },
      {
        id: 'm2',
        sender_name: 'Teacher T',
        created_at: new Date().toISOString(),
        deleted: false,
        reported: true,
        body: 'the reported text',
      },
      {
        id: 'm3',
        sender_name: 'Rahim Ahmed',
        created_at: new Date().toISOString(),
        deleted: true,
        reported: false,
        body: null,
      },
    ],
  };

  it('SAF-06 the view shows the audit notice, the reported message, and "message deleted" with no text', async () => {
    mockApi({
      'GET /api/admin/chat/reports?status=open': ok([
        {
          id: 'r1',
          category: 'harassment',
          status: 'open',
          about_message: true,
          target_name: 'Teacher T',
          department_id: 'd1',
          created_at: new Date().toISOString(),
        },
      ]),
      'GET /api/admin/chat/reports/r1': ok(report),
    });
    wrap(<AdminReportsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Open report' }));
    expect(await screen.findByRole('note')).toHaveTextContent(
      'Opening a report is recorded in the audit log',
    );
    const list = screen.getByRole('list', { name: 'Reported message' });
    expect(within(list).getByText('the reported text')).toBeInTheDocument();
    expect(within(list).getByText('Message deleted')).toBeInTheDocument();
  });

  it('SAF-08 closing sends the outcome and the note', async () => {
    const calls = mockApi({
      'GET /api/admin/chat/reports?status=open': ok([
        {
          id: 'r1',
          category: 'harassment',
          status: 'open',
          about_message: true,
          target_name: 'Teacher T',
          department_id: 'd1',
          created_at: new Date().toISOString(),
        },
      ]),
      'GET /api/admin/chat/reports/r1': ok(report),
      'POST /api/admin/chat/reports/r1/close': ok({
        id: 'r1',
        status: 'closed',
        outcome: 'warned',
      }),
    });
    wrap(<AdminReportsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Open report' }));
    await userEvent.selectOptions(await screen.findByRole('combobox'), 'warned');
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Note for the record (optional)' }),
      'first time',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Close report' }));
    await waitFor(() => {
      const closed = calls.find((c) => c.url === '/api/admin/chat/reports/r1/close');
      expect(closed.body).toEqual({ outcome: 'warned', note: 'first time' });
    });
  });
});
