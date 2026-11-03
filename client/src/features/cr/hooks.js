import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/lib/query-keys';
import { onEvent } from '@/lib/socket';
import * as api from './api.js';

const SOCKET_ROUTINE_CHANGED = 'routine.changed';

/** Spec 17: the section's overview. Refetched after every action on the dashboard. */
export function useCrOverview(sectionId) {
  return useQuery({
    queryKey: qk.crOverview(sectionId),
    queryFn: () => api.fetchOverview(sectionId),
    enabled: Boolean(sectionId),
    retry: false,
  });
}

/** CRD-DSH-05, CRD-DSH-06: the routine of the section and its groups, refreshed each minute. */
export function useCrRoutine(sectionId) {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      onEvent(SOCKET_ROUTINE_CHANGED, () =>
        queryClient.invalidateQueries({ queryKey: qk.crRoutine(sectionId) }),
      ),
    [queryClient, sectionId],
  );
  return useQuery({
    queryKey: qk.crRoutine(sectionId),
    queryFn: () => api.fetchRoutine(sectionId),
    enabled: Boolean(sectionId),
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: false,
  });
}

/** Every action on the dashboard changes what the overview shows, so it is refetched. */
function useAfterAction(sectionId) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: qk.crOverview(sectionId) });
}

/** CRD-DSH-04: one reminder to one unconfirmed student. The argument is the student's id. */
export function useSendReminder(sectionId) {
  const refresh = useAfterAction(sectionId);
  return useMutation({
    mutationFn: (studentId) => api.sendReminder(sectionId, studentId),
    onSettled: refresh,
  });
}

/** CRD-DSH-11: raise a flag. */
export function useRaiseFlag(sectionId) {
  const refresh = useAfterAction(sectionId);
  return useMutation({
    mutationFn: (body) => api.raiseFlag(sectionId, body),
    onSettled: refresh,
  });
}

/** CRD-DSH-09: accept (with or without a group) or reject a join request (spec 10). */
export function useDecideRequest(sectionId) {
  const refresh = useAfterAction(sectionId);
  return useMutation({
    mutationFn: ({ id, body }) => api.decideRequest(id, body),
    onSettled: refresh,
  });
}

/** CRD-DSH-10: change one accepted student's group (spec 10). `groupId` null clears it. */
export function useChangeGroup(sectionId) {
  const refresh = useAfterAction(sectionId);
  return useMutation({
    mutationFn: ({ id, groupId }) => api.changeGroup(id, groupId),
    onSettled: refresh,
  });
}
