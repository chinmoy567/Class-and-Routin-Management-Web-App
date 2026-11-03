import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/lib/query-keys';
import * as api from './api.js';
import { decideRegistration as decideRegistrationApi } from '@/features/teachers/api.js';

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

// Spec 18. Every admin write refreshes the admin lists, the dashboard and the students.
const adminWriteKeys = () => [['admin'], qk.dashboard()];
const refreshAdmin = (queryClient) =>
  adminWriteKeys().forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));

export function useAdminDashboard(departmentId) {
  return useQuery({
    queryKey: qk.adminDashboard(departmentId ?? 'all'),
    queryFn: () => api.fetchAdminDashboard(departmentId),
    retry: false,
  });
}

export function useStudentSearch({ q, department_id }) {
  const term = (q ?? '').trim();
  return useQuery({
    queryKey: qk.adminStudents(term, department_id ?? 'all'),
    queryFn: () => api.searchStudents({ q: term, department_id }),
    enabled: term.length >= 2,
    retry: false,
  });
}

/** One mutation hook per student action. Each refreshes the admin data and reports nothing else. */
function useAdminMutation(mutationFn) {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn, onSuccess: () => refreshAdmin(queryClient) });
}
export const useDeactivateStudent = () => useAdminMutation(api.deactivateStudent);
export const useReactivateStudent = () => useAdminMutation(api.reactivateStudent);
export const useGraduateStudent = () => useAdminMutation(api.graduateStudent);
export const useUngraduateStudent = () => useAdminMutation(api.ungraduateStudent);
export const useIssueTempPassword = () => useMutation({ mutationFn: api.issueTempPassword });
export const useRevokeUvClaim = () => useAdminMutation(api.revokeUvClaim);
export const useSetStudentGroup = () => useAdminMutation(api.setStudentGroup);
export const useDecideAppeal = () => useAdminMutation(api.decideAppeal);
export const useDecideRegistrationFromDashboard = () => useAdminMutation(decideRegistrationApi);

export function useSectionGroups(sectionId) {
  return useQuery({
    queryKey: ['admin', 'section-groups', sectionId],
    queryFn: () => api.fetchSectionGroups(sectionId),
    enabled: Boolean(sectionId),
    retry: false,
  });
}

export function useAdminFlags(filter) {
  return useQuery({
    queryKey: qk.adminFlags(filter.status, filter.department_id ?? 'all'),
    queryFn: () => api.fetchAdminFlags(filter),
    retry: false,
  });
}

export const useResolveFlag = () => useAdminMutation(api.resolveFlag);

export function useJoinList(filter) {
  return useQuery({
    queryKey: qk.adminJoinList(filter.view, filter.department_id ?? 'all'),
    queryFn: () => api.fetchJoinList(filter),
    retry: false,
  });
}

export function useAuditLog(params) {
  return useQuery({
    queryKey: qk.adminAudit(params),
    queryFn: () => api.fetchAuditLog(params),
    retry: false,
  });
}
export const useDecideEscalatedJoin = () => useAdminMutation(api.decideEscalatedJoin);
export const useDecideOwnClaim = () => useAdminMutation(api.decideOwnClaim);
