import type { UpdateActivityRequest } from '@planner/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DASHBOARD_KEY } from '../dashboard/useDashboard';
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

// Every activity mutation refreshes all cached activity lists (any filter combination) AND the
// Dashboard, which is derived from the same data, so the UI is consistent and never needs a reload.
function useInvalidateActivities() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['activities'] }),
      qc.invalidateQueries({ queryKey: DASHBOARD_KEY }),
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
