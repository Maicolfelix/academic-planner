import {
  evaluationResponseSchema,
  gradingPeriodResponseSchema,
  gradingProfileResponseSchema,
  setupGradingResponseSchema,
  subjectGradesResponseSchema,
  subjectResponseSchema,
  type CreateEvaluationInput,
  type CreateGradingPeriodInput,
  type Evaluation,
  type GradingPeriod,
  type GradingProfile,
  type SetupGradingInput,
  type SetupGradingResponse,
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

/** The scale and the cuts of a period in ONE request: all or nothing. */
export const setupGradingRequest = (
  periodId: string,
  input: SetupGradingInput,
): Promise<SetupGradingResponse> =>
  apiFetch(`/api/periods/${periodId}/grading/setup`, {
    method: 'POST',
    body: input,
    schema: setupGradingResponseSchema,
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
  periodId: string,
  input: CreateGradingPeriodInput,
): Promise<GradingPeriod> {
  return (
    await apiFetch(`/api/periods/${periodId}/grading-periods`, {
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
