import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { liveStatus } from '@crm/shared';
import { qk } from '@/lib/query-keys';
import { onEvent } from '@/lib/socket';
import { fetchMyRoutine } from './api.js';

/** RTN-12: fetch the routine for today + tomorrow. Refetches every 5 minutes. */
export function useMyRoutine(from, to) {
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

/**
 * RTN-11, RTN-12, RTN-13: compute live status every second.
 * Returns { status, data } where status is the liveStatus result.
 */
export function useLiveStatus(routineData) {
  const offsetRef = useRef(0);

  // Compute clock offset once when routineData arrives.
  useEffect(() => {
    if (routineData?.server_time) {
      offsetRef.current = new Date(routineData.server_time).getTime() - Date.now();
    }
  }, [routineData?.server_time]);

  const compute = () => {
    if (!routineData) return null;
    const serverNow = Date.now() + offsetRef.current;
    return liveStatus(routineData, serverNow);
  };

  const [status, setStatus] = useState(compute);

  // Recompute every second.
  useEffect(() => {
    const id = setInterval(() => setStatus(compute()), 1000);
    return () => clearInterval(id);
  });

  // Also recompute immediately when routineData changes.
  useEffect(() => {
    setStatus(compute());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routineData]);

  return status;
}

/** Format minutes since midnight as HH:MM. */
export function minutesToTime(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
