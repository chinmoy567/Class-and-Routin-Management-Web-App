import { useEffect } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/lib/query-keys';
import { onEvent } from '@/lib/socket';
import { t } from '@/lib/i18n';
import * as api from './api.js';

export const useConversations = () =>
  useQuery({ queryKey: qk.chatConversations(), queryFn: api.fetchConversations, retry: false });

export const useUnread = () =>
  useQuery({ queryKey: qk.chatUnread(), queryFn: api.fetchUnread, retry: false });

/** CHT-03: at least 2 characters before the server is asked. */
export const usePeopleSearch = (q) =>
  useQuery({
    queryKey: qk.chatPeople(q),
    queryFn: () => api.fetchPeople(q.trim()),
    enabled: q.trim().length >= 2,
    retry: false,
  });

/** CHT-06: pages go back in time. Page 0 is the newest 50, shown last. */
export const useMessages = (conversationId) =>
  useInfiniteQuery({
    queryKey: qk.chatMessages(conversationId),
    queryFn: ({ pageParam }) => api.fetchMessagePage(conversationId, pageParam),
    initialPageParam: null,
    getNextPageParam: (last) => last.next ?? undefined,
    enabled: Boolean(conversationId),
    retry: false,
  });

export const useMembers = (conversationId, enabled = true) =>
  useQuery({
    queryKey: qk.chatMembers(conversationId),
    queryFn: () => api.fetchMembers(conversationId),
    enabled: Boolean(conversationId) && enabled,
    retry: false,
  });

/** Every chat change refreshes the lists, the unread counts and the open conversation. */
function useChatMutation(mutationFn) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['chat'] });
    },
  });
}

export const useOpenDirect = () => useChatMutation(api.openDirect);
export const useSendMessage = () => useChatMutation(api.sendMessage);
export const useDeleteMessage = () => useChatMutation(api.deleteMessage);
export const useRemoveMember = () => useChatMutation(api.removeMember);
export const useAppealRemoval = () => useChatMutation(api.appealRemoval);
export const useMarkRead = () => useChatMutation(api.markRead);
// Spec 21: the upload reports progress through `onProgress` in its variables.
export const useUploadChatFile = () => useChatMutation(api.uploadChatFile);
// Spec 21, FIL-08: asking for a link changes no cached data.
export const useFileLink = () => useMutation({ mutationFn: api.fetchFileLink });

/**
 * CHT-14, CHT-16: the server pushes `message.new` and `message.status` with ids only. The client
 * refetches. A browser notification is shown only when the tab is hidden and the user allowed it.
 * The notification text is generic: no name, no message text.
 */
export function useChatSocket() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const refresh = () => queryClient.invalidateQueries({ queryKey: ['chat'] });
    const offNew = onEvent('message.new', () => {
      refresh();
      notifyIfHidden();
    });
    const offStatus = onEvent('message.status', refresh);
    return () => {
      offNew();
      offStatus();
    };
  }, [queryClient]);
}

export function notifyIfHidden() {
  try {
    if (typeof document === 'undefined' || !document.hidden) return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    new Notification(t('chat.notifyTitle'), { body: t('chat.notifyBody') });
  } catch {
    // Some browsers refuse notifications outside a user gesture. The list still updates.
  }
}
