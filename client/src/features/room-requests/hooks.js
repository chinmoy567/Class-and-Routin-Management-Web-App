import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/lib/query-keys';
import { onEvent } from '@/lib/socket';
import * as api from './api.js';

export const useMyRoomRequests = (enabled = true) =>
  useQuery({
    queryKey: qk.myRoomRequests(),
    queryFn: api.fetchMyRoomRequests,
    retry: false,
    enabled,
  });

/** BKG-02: the groups and teachers for a section, for the request form. */
export const useRoomRequestOptions = (sectionId) =>
  useQuery({
    queryKey: qk.roomRequestOptions(sectionId),
    queryFn: () => api.fetchRoomRequestOptions(sectionId),
    retry: false,
    enabled: Boolean(sectionId),
  });

export const useAdminRoomRequests = (status = 'pending', enabled = true) =>
  useQuery({
    queryKey: qk.adminRoomRequests(status),
    queryFn: () => api.fetchAdminRoomRequests(status),
    retry: false,
    enabled,
  });

/** Any change to a request also changes what the free-room view shows, so both refresh. */
function useInvalidatingRequests(mutationFn) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk.roomRequestsAll() });
      queryClient.invalidateQueries({ queryKey: qk.availabilityAll() });
    },
  });
}

export const useSendRoomRequest = () => useInvalidatingRequests(api.sendRoomRequest);
export const useDecideRoomRequest = () => useInvalidatingRequests(api.decideRoomRequest);
export const useCancelRoomRequest = () => useInvalidatingRequests(api.cancelRoomRequest);

/** BKG-20: the server pushes `booking.changed` (ids only). Refresh the lists and the free rooms. */
export function useRoomRequestSocket() {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      onEvent('booking.changed', () => {
        queryClient.invalidateQueries({ queryKey: qk.roomRequestsAll() });
        queryClient.invalidateQueries({ queryKey: qk.availabilityAll() });
      }),
    [queryClient],
  );
}
