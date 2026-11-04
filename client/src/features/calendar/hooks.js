import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/lib/query-keys';
import * as api from './api.js';

/** CAL-02: the events the admin can see, for a date range and optionally one department. */
export const useCalendarEvents = (params) =>
  useQuery({
    queryKey: qk.calendarEvents(params),
    queryFn: () => api.fetchCalendarEvents(params),
    retry: false,
  });

function useInvalidating(mutationFn) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.calendarAll() }),
  });
}

export const useCreateCalendarEvent = () => useInvalidating(api.createCalendarEvent);
export const useUpdateCalendarEvent = () => useInvalidating(api.updateCalendarEvent);
export const useDeleteCalendarEvent = () => useInvalidating(api.deleteCalendarEvent);

// Cancelling or restoring one class changes no list on this client; the server pushes the change.
export const useCancelClass = () => useMutation({ mutationFn: api.cancelClass });
export const useUndoCancelClass = () => useMutation({ mutationFn: api.undoCancelClass });
