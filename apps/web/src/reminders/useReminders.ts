import type { UpdateReminderInput } from '@planner/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createReminderRequest,
  deleteReminderRequest,
  fetchActivityReminders,
  fetchDueReminders,
  markSeenRequest,
  updateReminderRequest,
} from '../api/reminders';

/** Prefix shared by every reminder query: `['reminders', activityId]` and `['reminders', 'due']`. */
export const REMINDERS_KEY = ['reminders'] as const;
export const DUE_REMINDERS_KEY = ['reminders', 'due'] as const;

export function useActivityReminders(activityId: string) {
  return useQuery({
    queryKey: ['reminders', activityId],
    queryFn: () => fetchActivityReminders(activityId),
    retry: false,
  });
}

/** Reminders ready to show. Re-checked every minute so one that comes due appears without a reload. */
export function useDueReminders() {
  return useQuery({
    queryKey: DUE_REMINDERS_KEY,
    queryFn: fetchDueReminders,
    refetchInterval: 60_000,
    retry: false,
  });
}

// Any reminder change refreshes the per-activity lists AND the due list (and the nav badge that reads it).
function useInvalidateReminders() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: REMINDERS_KEY });
}

export function useCreateReminder() {
  const invalidate = useInvalidateReminders();
  return useMutation({ mutationFn: createReminderRequest, onSuccess: invalidate });
}

export function useUpdateReminder() {
  const invalidate = useInvalidateReminders();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateReminderInput }) =>
      updateReminderRequest(id, input),
    onSuccess: invalidate,
  });
}

export function useDeleteReminder() {
  const invalidate = useInvalidateReminders();
  return useMutation({ mutationFn: deleteReminderRequest, onSuccess: invalidate });
}

export function useMarkSeen() {
  const invalidate = useInvalidateReminders();
  return useMutation({ mutationFn: markSeenRequest, onSuccess: invalidate });
}
