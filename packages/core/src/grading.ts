import { z } from 'zod';
import { INVALID_CHARACTERS, hasNoNul, type EducationContext } from './academic.js';
import { WEIGHT_UNIT_TOTAL } from './gradingMath.js';

/**
 * GRADES (D36). The grading of a period hangs from the PERIOD (never from a study, an activity or the profile):
 *   AcademicPeriod → GradingProfile (the numeric scale) → GradingPeriod[] (the "cortes", shared by every subject of the period)
 *   → Evaluation[] (per subject) → Activity? (optional link).
 * A score is ALWAYS stored in the profile's scale (`scoreMilli`, thousandths); "18 of 20" is kept apart (`rawEarnedMilli` /
 * `rawMaxMilli`) and never replaces it. Only a period that belongs to a study can be graded.
 */

/** Scales are numeric and bounded (so the arithmetic can never overflow): 0..100.000. */
export const GRADE_MILLI_MAX = 100_000;
export const RAW_MILLI_MAX = 1_000_000_000;
export const WEIGHT_BP_MAX = 10_000;
export const GRADING_NAME_MAX = 80;

const milli = (max: number) =>
  z
    .number({ error: 'Ingresa un número.' })
    .int('Ingresa un número entero de milésimas.')
    .min(0)
    .max(max);
const scoreMilli = milli(GRADE_MILLI_MAX);
const weightBp = z
  .number({ error: 'Ingresa un porcentaje.' })
  .int('El peso debe ser un número entero de puntos básicos.')
  .min(1, 'El peso debe ser mayor que 0.')
  .max(WEIGHT_BP_MAX, 'El peso no puede pasar de 100 %.');

const nameSchema = z
  .string({ error: 'Ingresa el nombre.' })
  .trim()
  .min(1, 'Ingresa el nombre.')
  .max(GRADING_NAME_MAX, `El nombre es demasiado largo (máximo ${GRADING_NAME_MAX} caracteres).`)
  .refine(hasNoNul, INVALID_CHARACTERS);

// ── Scale ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** min < max and min ≤ pass ≤ max. Shared by the schema (all four given) and the service (merged with what is stored). */
export function scaleProblems(scale: { minMilli: number; maxMilli: number; passMilli: number }) {
  const problems: Record<string, string> = {};
  if (scale.minMilli >= scale.maxMilli)
    problems.maxMilli = 'La nota máxima debe ser mayor que la mínima.';
  if (scale.passMilli < scale.minMilli || scale.passMilli > scale.maxMilli)
    problems.passMilli = 'La nota para pasar debe estar dentro de la escala.';
  return problems;
}

const profileFields = {
  minMilli: scoreMilli,
  maxMilli: scoreMilli,
  passMilli: scoreMilli,
  decimals: z.number().int().min(0).max(3),
};

export const createGradingProfileSchema = z.strictObject(profileFields).superRefine((v, ctx) => {
  for (const [path, message] of Object.entries(scaleProblems(v)))
    ctx.addIssue({ code: 'custom', path: [path], message });
});
export type CreateGradingProfileInput = z.infer<typeof createGradingProfileSchema>;

export const updateGradingProfileSchema = z
  .strictObject({
    minMilli: profileFields.minMilli.optional(),
    maxMilli: profileFields.maxMilli.optional(),
    passMilli: profileFields.passMilli.optional(),
    decimals: profileFields.decimals.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'No hay nada que cambiar.');
export type UpdateGradingProfileInput = z.infer<typeof updateGradingProfileSchema>;

// ── Cuts ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const createGradingPeriodSchema = z.strictObject({
  name: nameSchema,
  finalShareBp: weightBp,
});
export type CreateGradingPeriodInput = z.infer<typeof createGradingPeriodSchema>;

export const updateGradingPeriodSchema = z
  .strictObject({ name: nameSchema.optional(), finalShareBp: weightBp.optional() })
  .refine((v) => v.name !== undefined || v.finalShareBp !== undefined, 'No hay nada que cambiar.');
export type UpdateGradingPeriodInput = z.infer<typeof updateGradingPeriodSchema>;

// ── Evaluations ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const rawField = milli(RAW_MILLI_MAX);

/** The raw pair travels whole: both or none (null = clear). Whether earned ≤ max is checked here when both are numbers. */
function checkRaw(
  v: { rawEarnedMilli?: number | null; rawMaxMilli?: number | null },
  ctx: z.RefinementCtx,
) {
  const earned = v.rawEarnedMilli;
  const max = v.rawMaxMilli;
  if ((earned === undefined) !== (max === undefined) || (earned === null) !== (max === null)) {
    ctx.addIssue({
      code: 'custom',
      path: ['rawMaxMilli'],
      message: 'Indica lo obtenido y el máximo juntos.',
    });
    return;
  }
  if (typeof earned === 'number' && typeof max === 'number') {
    if (max <= 0)
      ctx.addIssue({
        code: 'custom',
        path: ['rawMaxMilli'],
        message: 'El máximo debe ser mayor que 0.',
      });
    else if (earned > max)
      ctx.addIssue({
        code: 'custom',
        path: ['rawEarnedMilli'],
        message: 'Lo obtenido no puede superar el máximo.',
      });
  }
}

/** The subject, the cut, the link to an activity and the weight come from the client; the owner and the period never do. */
export const createEvaluationSchema = z
  .strictObject({
    subjectId: z.uuid(),
    gradingPeriodId: z.uuid(),
    activityId: z.uuid().nullable().optional(),
    name: nameSchema,
    periodShareBp: weightBp,
    scoreMilli: scoreMilli.nullable().optional(),
    rawEarnedMilli: rawField.nullable().optional(),
    rawMaxMilli: rawField.nullable().optional(),
  })
  .superRefine(checkRaw);
export type CreateEvaluationInput = z.infer<typeof createEvaluationSchema>;

/** The subject never changes (move = delete + create). Sending the raw pair needs both of its halves. */
export const updateEvaluationSchema = z
  .strictObject({
    gradingPeriodId: z.uuid().optional(),
    activityId: z.uuid().nullable().optional(),
    name: nameSchema.optional(),
    periodShareBp: weightBp.optional(),
    scoreMilli: scoreMilli.nullable().optional(),
    rawEarnedMilli: rawField.nullable().optional(),
    rawMaxMilli: rawField.nullable().optional(),
  })
  .superRefine(checkRaw)
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'No hay nada que cambiar.');
export type UpdateEvaluationInput = z.infer<typeof updateEvaluationSchema>;

// ── Responses ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export const gradingProfileSchema = z.object({
  id: z.uuid(),
  periodId: z.uuid(),
  minMilli: z.number(),
  maxMilli: z.number(),
  passMilli: z.number(),
  decimals: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type GradingProfile = z.infer<typeof gradingProfileSchema>;

export const gradingPeriodSchema = z.object({
  id: z.uuid(),
  periodId: z.uuid(),
  name: z.string(),
  position: z.number(),
  finalShareBp: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type GradingPeriod = z.infer<typeof gradingPeriodSchema>;

export const evaluationSchema = z.object({
  id: z.uuid(),
  periodId: z.uuid(),
  subjectId: z.uuid(),
  gradingPeriodId: z.uuid(),
  activityId: z.uuid().nullable(),
  name: z.string(),
  periodShareBp: z.number(),
  scoreMilli: z.number().nullable(),
  rawEarnedMilli: z.number().nullable(),
  rawMaxMilli: z.number().nullable(),
  scoredAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Evaluation = z.infer<typeof evaluationSchema>;

/** The configuration of one period: null profile = not configured (the period may still be graded later). */
export const periodGradingResponseSchema = z.object({
  profile: gradingProfileSchema.nullable(),
  gradingPeriods: z.array(gradingPeriodSchema),
});
export type PeriodGradingResponse = z.infer<typeof periodGradingResponseSchema>;

export const gradingProfileResponseSchema = z.object({ profile: gradingProfileSchema });
export const gradingPeriodResponseSchema = z.object({ gradingPeriod: gradingPeriodSchema });
export const evaluationResponseSchema = z.object({ evaluation: evaluationSchema });

export const subjectGradeSummarySchema = z.object({
  complete: z.boolean(),
  definedWeightUnits: z.number(),
  undefinedWeightUnits: z.number(),
  evaluatedWeightUnits: z.number(),
  remainingWeightUnits: z.number(),
  currentMilli: z.number().nullable(),
  currentPasses: z.boolean().nullable(),
  required: z.discriminatedUnion('status', [
    z.object({ status: z.literal('SECURED') }),
    z.object({ status: z.literal('IMPOSSIBLE') }),
    z.object({ status: z.literal('NEEDED'), requiredMilli: z.number() }),
  ]),
});
export type SubjectGradeSummaryDto = z.infer<typeof subjectGradeSummarySchema>;

/** GET /api/subjects/:id/grades. `profile` null = the subject's period has no grading configured (no summary then). */
export const subjectGradesResponseSchema = z.object({
  subjectId: z.uuid(),
  periodId: z.uuid(),
  profile: gradingProfileSchema.nullable(),
  gradingPeriods: z.array(gradingPeriodSchema),
  evaluations: z.array(evaluationSchema),
  summary: subjectGradeSummarySchema.nullable(),
});
export type SubjectGradesResponse = z.infer<typeof subjectGradesResponseSchema>;

/** What the interface calls a `GradingPeriod`, by the type of the study: nothing else may depend on this. */
export const GRADING_PERIOD_TERMS = {
  UNIVERSITY: { one: 'Corte', many: 'Cortes', theMany: 'los cortes' },
  SCHOOL: {
    one: 'Periodo de evaluación',
    many: 'Periodos de evaluación',
    theMany: 'los periodos de evaluación',
  },
  OTHER_ACADEMIC: { one: 'Etapa', many: 'Etapas', theMany: 'las etapas' },
} as const satisfies Record<EducationContext, { one: string; many: string; theMany: string }>;

/** The weights of one subject, as a percentage for display (units → 0..100). */
export const unitsToPercent = (units: number) => (units / WEIGHT_UNIT_TOTAL) * 100;

/**
 * `POST /api/periods/:id/grading/setup`: the scale AND the cuts of a period in ONE request, all or nothing, so a configuration
 * is never left half done. Same rules as the separate routes (the weights of the cuts add up to at most 100 %); at least one
 * cut ("Nota final" at 100 % when the period has no cuts).
 */
export const GRADING_PERIODS_MAX = 12;
export const setupGradingSchema = z
  .strictObject({
    profile: createGradingProfileSchema,
    gradingPeriods: z.array(createGradingPeriodSchema).min(1).max(GRADING_PERIODS_MAX),
  })
  .superRefine((v, ctx) => {
    const total = v.gradingPeriods.reduce((sum, c) => sum + c.finalShareBp, 0);
    if (total > WEIGHT_BP_MAX)
      ctx.addIssue({
        code: 'custom',
        path: ['gradingPeriods'],
        message: 'Los cortes no pueden sumar más de 100 %.',
      });
  });
export type SetupGradingInput = z.infer<typeof setupGradingSchema>;

export const setupGradingResponseSchema = z.object({
  profile: gradingProfileSchema,
  gradingPeriods: z.array(gradingPeriodSchema),
});
export type SetupGradingResponse = z.infer<typeof setupGradingResponseSchema>;
