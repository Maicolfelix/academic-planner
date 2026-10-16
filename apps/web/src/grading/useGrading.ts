import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateEvaluationInput,
  CreateGradingPeriodInput,
  SetupGradingInput,
  UpdateEvaluationInput,
  UpdateGradingPeriodInput,
  UpdateGradingProfileInput,
} from '@planner/core';
import {
  createEvaluationRequest,
  createGradingPeriodRequest,
  deleteEvaluationRequest,
  deleteGradingPeriodRequest,
  fetchSubject,
  fetchSubjectGrades,
  setupGradingRequest,
  updateEvaluationRequest,
  updateGradingPeriodRequest,
  updateGradingProfileRequest,
} from '../api/grading';

export const SUBJECT_GRADES_KEY = ['subject-grades'] as const;
export const subjectGradesKey = (subjectId: string) => [...SUBJECT_GRADES_KEY, subjectId] as const;
export const subjectKey = (subjectId: string) => ['subject', subjectId] as const;

export function useSubject(subjectId: string) {
  return useQuery({
    queryKey: subjectKey(subjectId),
    queryFn: () => fetchSubject(subjectId),
    retry: false,
  });
}

export function useSubjectGrades(subjectId: string) {
  return useQuery({
    queryKey: subjectGradesKey(subjectId),
    queryFn: () => fetchSubjectGrades(subjectId),
    retry: false,
  });
}

/**
 * The scale and the cuts belong to the PERIOD, so every subject of it shows them: changing them refreshes the grades of ALL the
 * subjects that are cached (one prefix). An evaluation belongs to one subject, so only that subject's grades are refreshed.
 * Nothing else in the app reads grades yet, so nothing else is invalidated.
 */
function useRefreshPeriodGrades() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: SUBJECT_GRADES_KEY });
}

function useRefreshSubjectGrades(subjectId: string) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: subjectGradesKey(subjectId) });
}

export function useSetupGrading(periodId: string) {
  const refresh = useRefreshPeriodGrades();
  return useMutation({
    mutationFn: (input: SetupGradingInput) => setupGradingRequest(periodId, input),
    onSuccess: refresh,
  });
}

export function useUpdateGradingProfile(periodId: string) {
  const refresh = useRefreshPeriodGrades();
  return useMutation({
    mutationFn: (input: UpdateGradingProfileInput) => updateGradingProfileRequest(periodId, input),
    onSuccess: refresh,
  });
}

export function useCreateGradingPeriod(periodId: string) {
  const refresh = useRefreshPeriodGrades();
  return useMutation({
    mutationFn: (input: CreateGradingPeriodInput) => createGradingPeriodRequest(periodId, input),
    onSuccess: refresh,
  });
}

export function useUpdateGradingPeriod() {
  const refresh = useRefreshPeriodGrades();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateGradingPeriodInput }) =>
      updateGradingPeriodRequest(id, input),
    onSuccess: refresh,
  });
}

export function useDeleteGradingPeriod() {
  const refresh = useRefreshPeriodGrades();
  return useMutation({ mutationFn: deleteGradingPeriodRequest, onSuccess: refresh });
}

export function useCreateEvaluation(subjectId: string) {
  const refresh = useRefreshSubjectGrades(subjectId);
  return useMutation({
    mutationFn: (input: CreateEvaluationInput) => createEvaluationRequest(input),
    onSuccess: refresh,
  });
}

export function useUpdateEvaluation(subjectId: string) {
  const refresh = useRefreshSubjectGrades(subjectId);
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateEvaluationInput }) =>
      updateEvaluationRequest(id, input),
    onSuccess: refresh,
  });
}

export function useDeleteEvaluation(subjectId: string) {
  const refresh = useRefreshSubjectGrades(subjectId);
  return useMutation({ mutationFn: deleteEvaluationRequest, onSuccess: refresh });
}
