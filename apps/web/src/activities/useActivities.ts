import type { UpdateActivityRequest } from '@planner/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DASHBOARD_KEY } from '../dashboard/useDashboard';
import { REMINDERS_KEY } from '../reminders/useReminders';
import {
  createActivityRequest,
  deleteActivityRequest,
  fetchActivities,
  updateActivityRequest,
  type ActivityQuery,
} from '../api/activities';

export function useActivities(query: ActivityQuery, enabled: boolean) {
  return useQuery({
    queryKey: ['activities', query],
    queryFn: () => fetchActivities(query),
    enabled,
    retry: false,
  });
}

// Every activity mutation refreshes all cached activity lists (any filter combination), the Dashboard
// (derived from the same data) AND the reminders (a new deadline, type or completion rewrites them
// on the server), so the UI is consistent and never needs a reload.
function useInvalidateActivities() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['activities'] }),
      qc.invalidateQueries({ queryKey: DASHBOARD_KEY }),
      qc.invalidateQueries({ queryKey: REMINDERS_KEY }),
    ]);
}

export function useCreateActivity() {
  const invalidate = useInvalidateActivities();
  return useMutation({ mutationFn: createActivityRequest, onSuccess: invalidate });
}

export function useUpdateActivity() {
  const invalidate = useInvalidateActivities();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateActivityRequest }) =>
      updateActivityRequest(id, input),
    onSuccess: invalidate,
  });
}

export function useDeleteActivity() {
  const invalidate = useInvalidateActivities();
  return useMutation({ mutationFn: deleteActivityRequest, onSuccess: invalidate });
}
