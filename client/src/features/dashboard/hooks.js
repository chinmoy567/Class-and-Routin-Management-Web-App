import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/lib/query-keys';
import { onEvent } from '@/lib/socket';
import { fetchDashboard, fetchSectionRoster } from './api.js';

/** DSH-01, DSH-04: the summary. Refreshes every minute (free rooms) and when the tab returns. */
export function useDashboard() {
  return useQuery({
    queryKey: qk.dashboard(),
    queryFn: fetchDashboard,
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: false,
  });
}

/** DSH-13: one section's roster. Only fetched once the teacher opens it. */
export function useSectionRoster(sectionId, enabled) {
  return useQuery({
    queryKey: qk.sectionRoster(sectionId),
    queryFn: () => fetchSectionRoster(sectionId),
    enabled: Boolean(enabled && sectionId),
    retry: false,
  });
}

/** DSH-04: a change to the routine, a booking or the calendar refreshes the dashboard at once. */
export function useDashboardSocket() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const refresh = () => queryClient.invalidateQueries({ queryKey: qk.dashboard() });
    const unsubs = ['routine.changed', 'booking.changed', 'calendar.changed'].map((e) =>
      onEvent(e, refresh),
    );
    return () => unsubs.forEach((fn) => fn());
  }, [queryClient]);
}
