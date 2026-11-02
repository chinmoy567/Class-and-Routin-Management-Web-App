import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/lib/query-keys';
import * as api from './api.js';

export const useSummary = (semesterId, departmentId) =>
  useQuery({
    queryKey: qk.repsSummary(semesterId, departmentId),
    queryFn: () => api.fetchSummary({ semesterId, departmentId }),
    enabled: Boolean(semesterId && departmentId),
    retry: false,
  });

export const useSectionReps = (sectionId) =>
  useQuery({
    queryKey: qk.repsSection(sectionId),
    queryFn: () => api.fetchSectionReps(sectionId),
    enabled: Boolean(sectionId),
    retry: false,
  });

/** Wait 300 ms after the last keystroke before searching. */
function useDebounced(value, ms = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

export function useStudentSearch(text, departmentId) {
  const q = useDebounced(text.trim());
  return useQuery({
    queryKey: qk.studentSearch(q, departmentId),
    queryFn: () => api.searchStudents({ q, departmentId }),
    enabled: q.length >= 2,
    retry: false,
  });
}

/** After any change the server is the truth: load the section and the readiness list again. */
function useRepMutation(fn) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.repsAll() }),
  });
}

export const useAssign = () => useRepMutation(api.assignRep);
export const useReappoint = () => useRepMutation(api.reappointReps);
export const useRemove = () => useRepMutation(api.removeRep);
