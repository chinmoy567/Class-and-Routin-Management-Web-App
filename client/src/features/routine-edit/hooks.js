import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/lib/query-keys';
import { onEvent } from '@/lib/socket';
import * as api from './api.js';

export const useSections = (semesterId) =>
  useQuery({
    queryKey: qk.editSections(semesterId),
    queryFn: () => api.fetchSections(semesterId),
    enabled: Boolean(semesterId),
    retry: false,
  });

export const useGrid = (sectionId) => {
  const queryClient = useQueryClient();
  // The server only says "something changed": fetch the grid again.
  useEffect(
    () =>
      onEvent('routine.changed', () =>
        queryClient.invalidateQueries({ queryKey: qk.editGridAll() }),
      ),
    [queryClient],
  );
  return useQuery({
    queryKey: qk.editGrid(sectionId),
    queryFn: () => api.fetchGrid(sectionId),
    enabled: Boolean(sectionId),
    retry: false,
  });
};

/** Success, a conflict or any failure: the server is the truth, so refetch the grid. */
function useEditMutation(fn, { sections = false } = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk.editGridAll() });
      if (sections) queryClient.invalidateQueries({ queryKey: qk.editSectionsAll() });
    },
  });
}

export const useCreateSlot = () => useEditMutation(api.createSlot);
export const useUpdateSlot = () => useEditMutation(api.updateSlot);
export const useDeleteSlot = () => useEditMutation(api.deleteSlot);
export const useCreateSection = () => useEditMutation(api.createSection, { sections: true });
export const useAddGroup = () => useEditMutation(api.addGroup, { sections: true });
export const useRenameGroup = () => useEditMutation(api.renameGroup, { sections: true });
export const useRemoveGroup = () => useEditMutation(api.removeGroup, { sections: true });
