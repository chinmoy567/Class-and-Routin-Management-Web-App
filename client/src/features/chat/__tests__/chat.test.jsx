import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { mockApi, ok, fail, meResponse } from '@/test/mockApi.jsx';
import { ChatListPage } from '@/routes/ChatListPage.jsx';
import { ConversationPage } from '@/routes/ConversationPage.jsx';
import { PersonSearchPage } from '@/routes/PersonSearchPage.jsx';
import { MessageBubble } from '../components/MessageBubble.jsx';

// The socket is not needed here; the chat screens only refetch on pushes.
vi.mock('@/lib/socket', () => ({ onEvent: () => () => {} }));

afterEach(() => vi.unstubAllGlobals());

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const renderAt = (path, element, pattern = path) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={client()}>
        <Routes>
          <Route path={pattern} element={element} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );

const conversations = [
  {
    id: 'c1',
    type: 'direct',
    name: 'Rahim Ahmed',
    photo_url: null,
    other_user_id: 'u2',
    closed: false,
    removed: false,
    last_message_at: '2026-11-05T04:00:00.000Z',
    unread: 2,
  },
  {
    id: 'g1',
    type: 'section_group',
    name: 'CSE 2-II-A · Fall 2026',
    photo_url: null,
    closed: false,
    removed: false,
    last_message_at: null,
    unread: 0,
  },
];

describe('CHT-15 the chat list', () => {
  it('CHT-15 shows each conversation with its unread count and the group name', async () => {
    mockApi({ 'GET /api/chat/conversations': ok(conversations) });
    renderAt('/chat', <ChatListPage />);
    expect(await screen.findByText('Rahim Ahmed')).toBeInTheDocument();
    expect(screen.getByLabelText('2 unread')).toHaveTextContent('2');
    expect(screen.getByText('CSE 2-II-A · Fall 2026')).toBeInTheDocument();
  });

  it('CHT-10a a removed group is listed with a notice, so the appeal can be reached (CHT-10a)', async () => {
    mockApi({
      'GET /api/chat/conversations': ok([{ ...conversations[1], removed: true }]),
    });
    renderAt('/chat', <ChatListPage />);
    expect(await screen.findByText('You were removed from this group')).toBeInTheDocument();
  });
});

describe('CHT-06, CHT-07, CHT-13 message bubbles', () => {
  const mine = {
    id: 'm1',
    mine: true,
    deleted: false,
    body: 'Hello',
    status: 'seen',
    created_at: '2026-11-05T04:00:00.000Z',
  };

  it('CHT-06 shows the status word for a one-to-one message and the body', () => {
    render(
      <ul>
        <MessageBubble message={mine} canDelete={false} onDelete={() => {}} />
      </ul>,
    );
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Seen')).toBeInTheDocument();
  });

  it('CHT-07 a deleted message reads "Message deleted" and shows no text', () => {
    render(
      <ul>
        <MessageBubble
          message={{ ...mine, deleted: true, body: null }}
          canDelete={false}
          onDelete={() => {}}
        />
      </ul>,
    );
    expect(screen.getByText('Message deleted')).toBeInTheDocument();
    expect(screen.queryByText('Hello')).toBeNull();
  });

  it('CHT-13 a group message shows no status (CHT-13)', () => {
    render(
      <ul>
        <MessageBubble message={{ ...mine, status: null }} canDelete={false} onDelete={() => {}} />
      </ul>,
    );
    expect(screen.queryByText('Seen')).toBeNull();
  });
});

describe('CHT-02, CHT-10a the conversation screen', () => {
  it('CHT-10a a removed member sees the notice and a one-time appeal form, and no messages', async () => {
    mockApi({
      'GET /api/chat/conversations': ok([{ ...conversations[1], removed: true }]),
      'GET /api/auth/me': meResponse('dashboard'),
    });
    renderAt('/chat/g1', <ConversationPage />, '/chat/:id');
    expect(await screen.findByText(/You were removed from this group/)).toBeInTheDocument();
    expect(screen.getByLabelText('Your appeal')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
  });

  it('CHT-12 a closed group shows the read-only banner and no send form', async () => {
    mockApi({
      'GET /api/chat/conversations': ok([{ ...conversations[1], closed: true }]),
      'GET /api/chat/conversations/g1/messages': ok([]),
      'GET /api/auth/me': meResponse('dashboard'),
      'GET /api/chat/conversations/g1/members': fail(404, 'NOT_FOUND'),
      'POST /api/chat/conversations/g1/read': ok(null),
    });
    renderAt('/chat/g1', <ConversationPage />, '/chat/:id');
    expect(await screen.findByText(/This group is closed for the semester/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
  });
});

describe('CHT-03 person search', () => {
  it('CHT-03 asks for at least 2 characters before searching', async () => {
    const calls = mockApi({});
    renderAt('/chat/new', <PersonSearchPage />);
    await userEvent.type(screen.getByLabelText('Find a person by name'), 'r');
    expect(screen.getByText('Type at least 2 characters.')).toBeInTheDocument();
    expect(calls.filter((c) => c.url.includes('/api/chat/people'))).toHaveLength(0);
  });

  it('CHT-03 CHT-04 lists people with role labels and no contact details', async () => {
    mockApi({
      'GET /api/chat/people?q=ra': ok([
        {
          id: 'u2',
          full_name: 'Rahim Ahmed',
          photo_url: null,
          department: { id: 'd1', code: 'CSE', name: 'CSE' },
          role_labels: ['student', 'CR'],
        },
      ]),
    });
    renderAt('/chat/new', <PersonSearchPage />);
    await userEvent.type(screen.getByLabelText('Find a person by name'), 'ra');
    expect(await screen.findByText('Rahim Ahmed')).toBeInTheDocument();
    expect(screen.getByText('CSE · student · CR')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/@|phone|UV/i);
  });
});
