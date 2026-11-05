import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { mockApi, ok, fail, meResponse } from '@/test/mockApi.jsx';
import { ChatUnreadCard } from '../components/ChatUnreadCard.jsx';
import { SectionCard } from '@/features/dashboard/components/SectionCard.jsx';
import { StartChatButton } from '../components/StartChatButton.jsx';

// The dashboard start-chat entry is behind a release flag; these tests run with it released.
vi.mock('@crm/shared', async (orig) => ({ ...(await orig()), isReleased: () => true }));
vi.mock('@/lib/socket', () => ({ onEvent: () => () => {} }));

afterEach(() => vi.unstubAllGlobals());

const renderWithRouter = (ui, path = '/dashboard') =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="*" element={ui} />
          <Route path="/chat" element={<p>chat list</p>} />
          <Route path="/chat/:id" element={<p>conversation</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('CHT-15 dashboard unread card', () => {
  it('CHT-15 shows the total unread count and links to the chat list', async () => {
    mockApi({ 'GET /api/chat/unread': ok({ total: 3, per_conversation: [] }) });
    renderWithRouter(<ChatUnreadCard />);
    expect(await screen.findByText('You have 3 unread messages.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Open chats' }));
    expect(await screen.findByText('chat list')).toBeInTheDocument();
  });

  it('CHT-15 says there is nothing unread when the total is zero', async () => {
    mockApi({ 'GET /api/chat/unread': ok({ total: 0, per_conversation: [] }) });
    renderWithRouter(<ChatUnreadCard />);
    expect(await screen.findByText('No unread messages.')).toBeInTheDocument();
  });

  it('CHT-15 shows a message, not a blank card, when the count cannot be loaded', async () => {
    mockApi({ 'GET /api/chat/unread': fail(500, 'INTERNAL') });
    renderWithRouter(<ChatUnreadCard />);
    expect(await screen.findByText('We could not load your unread messages.')).toBeInTheDocument();
  });
});

describe('CHT-04 start chat from the CR/DCR card', () => {
  const section = { id: 's1', name: 'CSE 2-II-A', group: null, my_role: null };
  const representatives = [
    { user_id: 'u1', role: 'cr', name: 'Rafi Ahmed', photo: null },
    { user_id: 'u9', role: 'dcr', name: 'Nusrat Jahan', photo: null },
  ];

  it('CHT-04 offers "Message" for each representative except the viewer', async () => {
    mockApi({ 'GET /api/auth/me': meResponse(null) });
    renderWithRouter(
      <SectionCard section={section} representatives={representatives} courses={[]} />,
    );
    // u1 is the signed-in user (meResponse id), so only the DCR can be messaged.
    expect(await screen.findByRole('button', { name: 'Message Nusrat Jahan' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Message Rafi Ahmed' })).toBeNull();
  });

  it('CHT-04 starting a chat from the card opens the conversation', async () => {
    mockApi({
      'GET /api/auth/me': meResponse(null),
      'POST /api/chat/direct': ok({ id: 'c77' }),
    });
    renderWithRouter(
      <SectionCard section={section} representatives={representatives} courses={[]} />,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Message Nusrat Jahan' }));
    expect(await screen.findByText('conversation')).toBeInTheDocument();
  });
});

describe('CHT-04 the start-chat button names its person', () => {
  it('CHT-04 uses the person name in the screen-reader label', () => {
    renderWithRouter(<StartChatButton userId="u5" name="Tanvir Hasan" />);
    expect(screen.getByRole('button', { name: 'Message Tanvir Hasan' })).toBeInTheDocument();
  });
});
