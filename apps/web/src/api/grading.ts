import {
  evaluationResponseSchema,
  gradingPeriodResponseSchema,
  gradingProfileResponseSchema,
  replaceCutWeightsResponseSchema,
  setupSubjectGradingResponseSchema,
  subjectGradesResponseSchema,
  subjectResponseSchema,
  type CreateEvaluationInput,
  type CreateGradingPeriodInput,
  type Evaluation,
  type GradingPeriod,
  type GradingProfile,
  type ReplaceCutWeightsInput,
  type SetupSubjectGradingInput,
  type SetupSubjectGradingResponse,
  type Subject,
  type SubjectGradesResponse,
  type UpdateEvaluationInput,
  type UpdateGradingPeriodInput,
  type UpdateGradingProfileInput,
} from '@planner/core';
import { apiFetch } from './client';

export async function fetchSubject(id: string): Promise<Subject> {
  return (await apiFetch(`/api/subjects/${id}`, { schema: subjectResponseSchema })).subject;
}

/** The evaluations of a subject, the scale and cuts of its period, and the exact summary. */
export const fetchSubjectGrades = (id: string): Promise<SubjectGradesResponse> =>
  apiFetch(`/api/subjects/${id}/grades`, { schema: subjectGradesResponseSchema });

/**
 * How ONE subject splits its final grade (and, while the period has no scale yet, the period's scale) in ONE request: all or
 * nothing. The scale is the period's; the cuts are the subject's own.
 */
export const setupSubjectGradingRequest = (
  subjectId: string,
  input: SetupSubjectGradingInput,
): Promise<SetupSubjectGradingResponse> =>
  apiFetch(`/api/subjects/${subjectId}/grading/setup`, {
    method: 'POST',
    body: input,
    schema: setupSubjectGradingResponseSchema,
  });

/** The weights of ALL the cuts of a subject, replaced together and adding up to exactly 100 % (all or nothing). */
export const replaceCutWeightsRequest = (
  subjectId: string,
  input: ReplaceCutWeightsInput,
): Promise<{ gradingPeriods: GradingPeriod[] }> =>
  apiFetch(`/api/subjects/${subjectId}/grading-periods/distribution`, {
    method: 'POST',
    body: input,
    schema: replaceCutWeightsResponseSchema,
  });

export async function updateGradingProfileRequest(
  periodId: string,
  input: UpdateGradingProfileInput,
): Promise<GradingProfile> {
  return (
    await apiFetch(`/api/periods/${periodId}/grading`, {
      method: 'PATCH',
      body: input,
      schema: gradingProfileResponseSchema,
    })
  ).profile;
}

export async function createGradingPeriodRequest(
  subjectId: string,
  input: CreateGradingPeriodInput,
): Promise<GradingPeriod> {
  return (
    await apiFetch(`/api/subjects/${subjectId}/grading-periods`, {
      method: 'POST',
      body: input,
      schema: gradingPeriodResponseSchema,
    })
  ).gradingPeriod;
}

export async function updateGradingPeriodRequest(
  id: string,
  input: UpdateGradingPeriodInput,
): Promise<GradingPeriod> {
  return (
    await apiFetch(`/api/grading-periods/${id}`, {
      method: 'PATCH',
      body: input,
      schema: gradingPeriodResponseSchema,
    })
  ).gradingPeriod;
}

export const deleteGradingPeriodRequest = (id: string): Promise<void> =>
  apiFetch(`/api/grading-periods/${id}`, { method: 'DELETE' });

export async function createEvaluationRequest(input: CreateEvaluationInput): Promise<Evaluation> {
  return (
    await apiFetch('/api/evaluations', {
      method: 'POST',
      body: input,
      schema: evaluationResponseSchema,
    })
  ).evaluation;
}

export async function updateEvaluationRequest(
  id: string,
  input: UpdateEvaluationInput,
): Promise<Evaluation> {
  return (
    await apiFetch(`/api/evaluations/${id}`, {
      method: 'PATCH',
      body: input,
      schema: evaluationResponseSchema,
    })
  ).evaluation;
}

export const deleteEvaluationRequest = (id: string): Promise<void> =>
  apiFetch(`/api/evaluations/${id}`, { method: 'DELETE' });
