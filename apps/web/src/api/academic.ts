import {
  periodListResponseSchema,
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

export async function createPeriodRequest(input: CreatePeriodInput): Promise<AcademicPeriod> {
  return (
    await apiFetch('/api/periods', { method: 'POST', body: input, schema: periodResponseSchema })
  ).period;
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
