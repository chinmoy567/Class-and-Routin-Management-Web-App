import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { qk } from '@/lib/query-keys';
import * as authApi from './api.js';

/** The signed-in person, or null when signed out. The server decides `next`. */
export function useMe() {
  return useQuery({ queryKey: qk.me(), queryFn: authApi.fetchMe, retry: false, staleTime: 15_000 });
}

/** True when the signed-in person holds the super admin role (the server still enforces it). */
export function useIsSuperAdmin() {
  const { data } = useMe();
  return (data?.roles ?? []).some((r) => r.role === 'super_admin');
}

/** True for a super admin or a department admin (the server still enforces it). */
export function useIsAdmin() {
  const { data } = useMe();
  return (data?.roles ?? []).some((r) => r.role === 'super_admin' || r.role === 'dept_admin');
}

export function useDepartments(enabled) {
  return useQuery({
    queryKey: qk.departments(),
    queryFn: authApi.fetchDepartments,
    enabled,
    retry: false,
  });
}

/** After sign-in, the second step or TOTP setup: refresh /me and go where `next` says. */
export function useGoNext() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return async (next) => {
    await queryClient.invalidateQueries({ queryKey: qk.me() });
    navigate(authApi.pathForNext(next), { replace: true });
  };
}

export function useSignIn() {
  const goNext = useGoNext();
  return useMutation({ mutationFn: authApi.signIn, onSuccess: (data) => goNext(data.next) });
}

export function useSecondStep() {
  const goNext = useGoNext();
  return useMutation({
    mutationFn: authApi.submitSecondStep,
    onSuccess: (data) => goNext(data.next),
  });
}

export function useConfirmTotp() {
  const goNext = useGoNext();
  return useMutation({ mutationFn: authApi.confirmTotp, onSuccess: (data) => goNext(data.next) });
}

export function useSignOut() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: authApi.signOut,
    onSettled: () => {
      queryClient.setQueryData(qk.me(), null);
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
      navigate('/login', { replace: true });
    },
  });
}
