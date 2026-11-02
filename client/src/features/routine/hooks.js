import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { liveStatus } from '@crm/shared';
import { qk } from '@/lib/query-keys';
import { onEvent } from '@/lib/socket';
import { fetchMyRoutine } from './api.js';

/** RTN-12: fetch the routine. Refetches every 5 minutes and when the tab becomes visible again. */
export function useMyRoutine(from, to) {
  const queryClient = useQueryClient();
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        queryClient.invalidateQueries({ queryKey: qk.myRoutineAll() });
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [queryClient]);
  return useQuery({
    queryKey: qk.myRoutine(from ?? null, to ?? null),
    queryFn: () => fetchMyRoutine(from, to),
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    retry: false,
  });
}

/** RTN-12: invalidate on routine/booking/calendar changed push events. */
export function useRoutineSocket() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const unsubs = [
      onEvent('routine.changed', () =>
        queryClient.invalidateQueries({ queryKey: qk.myRoutineAll() }),
      ),
      onEvent('booking.changed', () =>
        queryClient.invalidateQueries({ queryKey: qk.myRoutineAll() }),
      ),
      onEvent('calendar.changed', () =>
        queryClient.invalidateQueries({ queryKey: qk.myRoutineAll() }),
      ),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [queryClient]);
}

/** RTN-11: the live status for a routine, using server time plus the offset from the response. */
function computeStatus(routineData, offsetMs) {
  if (!routineData) return null;
  return liveStatus(routineData, Date.now() + offsetMs);
}

/**
 * RTN-11, RTN-12, RTN-13: the live status, recomputed every second with no server call.
 * The clock offset is taken from `server_time` each time routine data arrives.
 */
export function useLiveStatus(routineData) {
  const offsetRef = useRef(0);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    if (routineData?.server_time) {
      offsetRef.current = new Date(routineData.server_time).getTime() - Date.now();
    }
    setStatus(computeStatus(routineData, offsetRef.current));
    const id = setInterval(() => setStatus(computeStatus(routineData, offsetRef.current)), 1000);
    return () => clearInterval(id);
  }, [routineData]);

  return status;
}

/** Format minutes since midnight as HH:MM. */
export function minutesToTime(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
