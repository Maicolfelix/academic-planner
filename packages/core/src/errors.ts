import { z } from 'zod';

/** Uniform error envelope returned by every failing API response. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

/** `{ field: [messages] }` from a failed parse, for showing errors next to form fields. */
export const fieldErrorsOf = (error: z.ZodError): Record<string, string[]> =>
  z.flattenError(error).fieldErrors as Record<string, string[]>;
