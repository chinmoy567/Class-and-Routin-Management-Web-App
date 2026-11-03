import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/lib/query-keys';
import { useGoNext } from '@/features/auth/hooks.js';
import * as api from './api.js';

export const useReadiness = (semesterId) =>
  useQuery({
    queryKey: qk.rolloverReadiness(semesterId),
    queryFn: () => api.fetchReadiness(semesterId),
    enabled: Boolean(semesterId),
    retry: false,
  });

/** Spec 14: making a semester current changes the semesters, the routine and the calendar. */
export function useMakeCurrent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.makeCurrent,
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.adminSemesters() }),
        queryClient.invalidateQueries({ queryKey: qk.currentSemester() }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'rollover'] }),
      ]),
  });
}

export const useSemesterUpdate = () =>
  useQuery({ queryKey: qk.semesterUpdate(), queryFn: api.fetchSemesterUpdate, retry: false });

/** ROL-09: a graduated student no longer belongs on the update screen. */
export function useGraduate() {
  const goNext = useGoNext();
  return useMutation({
    mutationFn: api.graduate,
    onSuccess: () => goNext('dashboard'),
  });
}

/** ROL-10: "not enrolled" keeps the student here, so only the screen's data changes. */
export function useNotEnrolled() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.notEnrolled,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.semesterUpdate() }),
  });
}
