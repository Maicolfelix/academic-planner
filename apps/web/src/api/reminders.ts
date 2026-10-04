import {
  dueRemindersResponseSchema,
  markSeenResponseSchema,
  reminderListResponseSchema,
  reminderResponseSchema,
  type CreateReminderInput,
  type DueReminder,
  type Reminder,
  type UpdateReminderInput,
} from '@planner/core';
import { apiFetch } from './client';

export const fetchActivityReminders = async (activityId: string): Promise<Reminder[]> =>
  (
    await apiFetch(`/api/reminders?activityId=${activityId}`, {
      schema: reminderListResponseSchema,
    })
  ).reminders;

export const fetchDueReminders = (): Promise<{ reminders: DueReminder[]; total: number }> =>
  apiFetch('/api/reminders/due', { schema: dueRemindersResponseSchema });

export async function createReminderRequest(input: CreateReminderInput): Promise<Reminder> {
  return (
    await apiFetch('/api/reminders', {
      method: 'POST',
      body: input,
      schema: reminderResponseSchema,
    })
  ).reminder;
}

export async function updateReminderRequest(
  id: string,
  input: UpdateReminderInput,
): Promise<Reminder> {
  return (
    await apiFetch(`/api/reminders/${id}`, {
      method: 'PATCH',
      body: input,
      schema: reminderResponseSchema,
    })
  ).reminder;
}

export const deleteReminderRequest = (id: string): Promise<void> =>
  apiFetch(`/api/reminders/${id}`, { method: 'DELETE' });

export const markSeenRequest = (ids: string[]) =>
  apiFetch('/api/reminders/seen', {
    method: 'POST',
    body: { ids },
    schema: markSeenResponseSchema,
  });
