import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/lib/query-keys';
import * as api from './api.js';

export const useAdminDepartments = () =>
  useQuery({ queryKey: qk.adminDepartments(), queryFn: api.fetchAdminDepartments, retry: false });

export const useAdmins = () =>
  useQuery({ queryKey: qk.admins(), queryFn: api.fetchAdmins, retry: false });

export function useUserSearch(q) {
  const term = q.trim();
  return useQuery({
    queryKey: qk.userSearch(term),
    queryFn: () => api.searchUsers(term),
    enabled: term.length >= 2,
    retry: false,
  });
}

function useInvalidating(mutationFn, keys) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => keys.forEach((queryKey) => queryClient.invalidateQueries({ queryKey })),
  });
}

const deptKeys = [qk.adminDepartments(), qk.departments()];
export const useCreateDepartment = () => useInvalidating(api.createDepartment, deptKeys);
export const useUpdateDepartment = () => useInvalidating(api.updateDepartment, deptKeys);
export const useRetireDepartment = () => useInvalidating(api.retireDepartment, deptKeys);

export const useGrantAdminRole = () => useInvalidating(api.grantAdminRole, [qk.admins()]);
export const useRemoveAdminRole = () => useInvalidating(api.removeAdminRole, [qk.admins()]);
export const useResetAdminPassword = () => useMutation({ mutationFn: api.resetAdminPassword });
export const useResetAdminSecondStep = () => useMutation({ mutationFn: api.resetAdminSecondStep });

export const useCurrentSemester = () =>
  useQuery({ queryKey: qk.currentSemester(), queryFn: api.fetchCurrentSemester, retry: false });

export const useAdminSemesters = () =>
  useQuery({ queryKey: qk.adminSemesters(), queryFn: api.fetchAdminSemesters, retry: false });

const semesterKeys = [qk.adminSemesters(), qk.currentSemester()];
export const useCreateSemester = () => useInvalidating(api.createSemester, semesterKeys);
export const useUpdateSemester = () => useInvalidating(api.updateSemester, semesterKeys);
export const useDeleteSemester = () => useInvalidating(api.deleteSemester, semesterKeys);
export const useBootstrapSemester = () => useInvalidating(api.bootstrapSemester, semesterKeys);
