import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/lib/query-keys';
import * as api from './api.js';
import { onEvent } from '@/lib/socket';

export const useAdminRooms = (departmentId) =>
  useQuery({
    queryKey: qk.adminRooms(departmentId),
    queryFn: () => api.fetchAdminRooms(departmentId),
    enabled: Boolean(departmentId),
    retry: false,
  });

function useInvalidating(mutationFn) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.adminRoomsAll() });
      queryClient.invalidateQueries({ queryKey: qk.rooms() });
    },
  });
}

export const useCreateRoom = () => useInvalidating(api.createRoom);
export const useUpdateRoom = () => useInvalidating(api.updateRoom);
export const useAddRoomAlias = () => useInvalidating(api.addRoomAlias);
export const useRemoveRoomAlias = () => useInvalidating(api.removeRoomAlias);
export const useSetRoomShares = () => useInvalidating(api.setRoomShares);
export const useRetireRoom = () => useInvalidating(api.retireRoom);

/** FRV-01: the free-room view for one date and range. Disabled until the range is complete. */
export const useAvailability = (params) =>
  useQuery({
    queryKey: qk.availability(params),
    queryFn: () => api.fetchAvailability(params),
    enabled: Boolean(params),
    retry: false,
  });

/** FRV-07: the rooms free in the next 55 minutes. */
export const useFreeNow = () =>
  useQuery({
    queryKey: qk.freeNow(),
    queryFn: api.fetchFreeNow,
    refetchInterval: 60 * 1000,
    retry: false,
  });

/** Refresh the free-room views when the routine, a booking or the calendar changes. */
export function useAvailabilitySocket() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: qk.availabilityAll() });
      queryClient.invalidateQueries({ queryKey: qk.freeNow() });
    };
    const unsubs = ['routine.changed', 'booking.changed', 'calendar.changed'].map((e) =>
      onEvent(e, refresh),
    );
    return () => unsubs.forEach((fn) => fn());
  }, [queryClient]);
}
