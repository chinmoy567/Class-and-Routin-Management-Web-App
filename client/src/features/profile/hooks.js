import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/lib/query-keys';
import * as api from './api.js';

/** The signed-in person's own profile. Re-checks every 3 seconds while a photo is being scanned. */
export function useProfile() {
  return useQuery({
    queryKey: qk.profile(),
    queryFn: api.fetchProfile,
    retry: false,
    refetchInterval: (query) => (query.state.data?.photo?.status === 'pending' ? 3000 : false),
  });
}

export function usePublicProfile(id) {
  return useQuery({
    queryKey: qk.user(id),
    queryFn: () => api.fetchPublicProfile(id),
    retry: false,
  });
}

function useProfileMutation(mutationFn) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.profile() }),
  });
}

export const useUpdatePhone = () => useProfileMutation(api.updatePhone);
export const useUploadPhoto = () => useProfileMutation(api.uploadPhoto);
export const useDeletePhoto = () => useProfileMutation(api.deletePhoto);
export const useRequestEmailChange = () => useMutation({ mutationFn: api.requestEmailChange });

export function useConfirmEmailChange() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.confirmEmailChange,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.me() });
      queryClient.invalidateQueries({ queryKey: qk.profile() });
    },
  });
}
