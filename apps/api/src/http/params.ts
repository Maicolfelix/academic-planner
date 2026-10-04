import { z } from 'zod';
import { notFound } from '../errors/AppError.js';

const uuid = z.uuid();

/**
 * A malformed id in the path is "not found", exactly like an unknown or foreign one: the client
 * learns nothing about which ids exist.
 */
export function parseIdParam(value: unknown, message?: string): string {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) throw notFound(message);
  return parsed.data;
}
