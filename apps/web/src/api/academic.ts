import {
  currentPeriodsResponseSchema,
  type CurrentPeriodContext,
  homePeriodResponseSchema,
  periodListResponseSchema,
  subjectBatchResponseSchema,
  type CreateSubjectBatchInput,
  type SubjectBatchResponse,
  type UpdatePeriodRequest,
  periodResponseSchema,
  subjectListResponseSchema,
  subjectResponseSchema,
  type AcademicPeriod,
  type CreatePeriodInput,
  type CreateSubjectInput,
  type Subject,
  type UpdateSubjectInput,
} from '@planner/core';
import { apiFetch } from './client';

export async function fetchPeriods(): Promise<AcademicPeriod[]> {
  return (await apiFetch('/api/periods', { schema: periodListResponseSchema })).periods;
}

/** Every current, active period with its study, in the server's order (the general one, the primary study's, the rest). */
export async function fetchCurrentPeriods(): Promise<CurrentPeriodContext[]> {
  return (await apiFetch('/api/periods/current', { schema: currentPeriodsResponseSchema })).periods;
}

/** The HOME current period as the server decides it (never derived from the list), or null when there is none. */
export async function fetchHomePeriod(): Promise<AcademicPeriod | null> {
  return (await apiFetch('/api/periods/home', { schema: homePeriodResponseSchema })).period;
}

export async function createPeriodRequest(input: CreatePeriodInput): Promise<AcademicPeriod> {
  return (
    await apiFetch('/api/periods', { method: 'POST', body: input, schema: periodResponseSchema })
  ).period;
}

/** Changes the period the server finds by id (here: its study level). The answer is the period as it is now. */
export async function updatePeriodRequest(
  id: string,
  input: UpdatePeriodRequest,
): Promise<AcademicPeriod> {
  return (
    await apiFetch(`/api/periods/${id}`, {
      method: 'PATCH',
      body: input,
      schema: periodResponseSchema,
    })
  ).period;
}

/** Several subjects in the current period in ONE request (quick setup): existing ones are reused, never an error. */
export async function createSubjectsBatchRequest(
  input: CreateSubjectBatchInput,
): Promise<SubjectBatchResponse> {
  return apiFetch('/api/subjects/batch', {
    method: 'POST',
    body: input,
    schema: subjectBatchResponseSchema,
  });
}

export async function fetchSubjects(periodId: string): Promise<Subject[]> {
  return (
    await apiFetch(`/api/subjects?periodId=${encodeURIComponent(periodId)}`, {
      schema: subjectListResponseSchema,
    })
  ).subjects;
}

export async function createSubjectRequest(input: CreateSubjectInput): Promise<Subject> {
  return (
    await apiFetch('/api/subjects', { method: 'POST', body: input, schema: subjectResponseSchema })
  ).subject;
}

export async function updateSubjectRequest(
  id: string,
  input: UpdateSubjectInput,
): Promise<Subject> {
  return (
    await apiFetch(`/api/subjects/${id}`, {
      method: 'PATCH',
      body: input,
      schema: subjectResponseSchema,
    })
  ).subject;
}

export const deleteSubjectRequest = (id: string): Promise<void> =>
  apiFetch(`/api/subjects/${id}`, { method: 'DELETE' });
