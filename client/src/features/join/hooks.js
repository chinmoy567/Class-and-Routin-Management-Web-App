import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/lib/query-keys';
import { useGoNext } from '@/features/auth/hooks.js';
import * as api from './api.js';

export const useJoinOptions = () =>
  useQuery({ queryKey: qk.joinOptions(), queryFn: api.fetchOptions, retry: false });

export const useMyRequest = () =>
  useQuery({ queryKey: qk.myJoinRequest(), queryFn: api.fetchMyRequest, retry: false });

/** JR-01: after sending, the server decides the next screen. */
export function useSendRequest() {
  const goNext = useGoNext();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.sendRequest,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.myJoinRequest() });
      await goNext('waiting-approval');
    },
  });
}

export function useWithdraw() {
  const goNext = useGoNext();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.withdrawRequest,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.myJoinRequest() });
      await goNext('join-form');
    },
  });
}

export function useAppeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.appealRequest,
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.myJoinRequest() }),
  });
}
