import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/lib/query-keys';
import * as api from './api.js';

export const useRegistrations = () =>
  useQuery({ queryKey: qk.teacherRegistrations(), queryFn: api.fetchRegistrations, retry: false });

export const useMyRegistration = () =>
  useQuery({
    queryKey: qk.myTeacherRegistration(),
    queryFn: api.fetchMyRegistration,
    retry: false,
  });

export const useTeachers = (departmentId) =>
  useQuery({
    queryKey: qk.teachers(departmentId),
    queryFn: () => api.fetchTeachers(departmentId),
    enabled: Boolean(departmentId),
    retry: false,
  });

export const useTeacherAccounts = (departmentId) =>
  useQuery({
    queryKey: qk.teacherAccounts(departmentId),
    queryFn: () => api.fetchTeacherAccounts(departmentId),
    enabled: Boolean(departmentId),
    retry: false,
  });

function useInvalidating(mutationFn) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.teachersAll() });
      queryClient.invalidateQueries({ queryKey: qk.teacherRegistrations() });
    },
  });
}

export const useDecideRegistration = () => useInvalidating(api.decideRegistration);
export const useCreateTeacher = () => useInvalidating(api.createTeacher);
export const useLinkTeacher = () => useInvalidating(api.linkTeacher);
export const useUnlinkTeacher = () => useInvalidating(api.unlinkTeacher);
export const useChangeAccount = () => useInvalidating(api.changeAccount);

/** TCH-05: after applying again, /me moves the person back to the waiting screen. */
export function useApplyAgain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.applyAgain,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.me() }),
  });
}
