import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/lib/query-keys';
import * as api from './api.js';

export const useImports = (semesterId, departmentId) =>
  useQuery({
    queryKey: qk.imports(semesterId, departmentId),
    queryFn: () => api.fetchImports(semesterId, departmentId),
    enabled: Boolean(semesterId && departmentId),
    retry: false,
  });

export const usePreview = (id) =>
  useQuery({
    queryKey: qk.importPreview(id),
    queryFn: () => api.fetchPreview(id),
    enabled: Boolean(id),
    retry: false,
  });

function useImportMutation(fn) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    // Success or a "already decided" answer, the server state is the truth: refetch it.
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.importsAll() }),
  });
}

export const useUploadImport = () => useImportMutation(api.uploadImport);
export const useConfirmIssue = () => useImportMutation(api.confirmIssue);
export const useSaveKeepChoices = () => useImportMutation(api.saveKeepChoices);
export const usePublishImport = () => useImportMutation(api.publishImport);
