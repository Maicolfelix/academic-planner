import { attentionResponseSchema, type Attention } from '@planner/core';
import { apiFetch } from './client';

export async function fetchAttention(): Promise<Attention> {
  return (await apiFetch('/api/attention', { schema: attentionResponseSchema })).attention;
}
