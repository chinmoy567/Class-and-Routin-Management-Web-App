import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/lib/query-keys';
import * as api from './api.js';

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
