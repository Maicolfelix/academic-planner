import { z } from 'zod';
import {
  INVALID_CHARACTERS,
  SUBJECT_BATCH_MAX,
  educationContextSchema,
  hasNoNul,
  periodSchema,
  studyPeriodSchema,
  subjectNameSchema,
  subjectSchema,
} from './academic.js';
import { findProgramByKey } from './profile.js';

/**
 * A STUDY TRACK is one formation the person takes: a degree, school, a technical program, a diploma, a language course. A
 * user may have several at the same time (0..n; none is valid) and `primaryUse` is NOT a list of them: it only says what the
 * person mainly uses the app for.
 *
 * Like the profile it DESCRIBES: it is not a permission, no rule reads its `type` or `name` to allow or deny anything, and no
 * behaviour may depend on a particular program (no `if (name === 'Medicina')`). The `type` is the same vocabulary a subject's
 * `educationContext` uses (there is no PERSONAL: personal things are not a formation); it is correctable at any time and
 * changing it never rewrites the `educationContext` that existing subjects already carry (they keep their own snapshot).
 */

export const STUDY_TRACK_NAME_MAX = 80;
export const STUDY_TRACK_KEY_MAX = 60;

export const STUDY_TRACK_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;
export type StudyTrackStatus = (typeof STUDY_TRACK_STATUSES)[number];

/**
 * The VISIBLE name of the study, not necessarily a career: "Medicina", "Colegio", "Universidad", "Técnico en Sistemas",
 * "Diplomado en Ciberseguridad", "Inglés B2". Trimmed, 1..80 characters, no NUL; no institution is asked for.
 */
export const studyTrackNameSchema = z
  .string({ error: 'Ingresa el nombre del estudio.' })
  .trim()
  .min(1, 'Ingresa el nombre del estudio.')
  .max(
    STUDY_TRACK_NAME_MAX,
    `El nombre es demasiado largo (máximo ${STUDY_TRACK_NAME_MAX} caracteres).`,
  )
  .refine(hasNoNul, INVALID_CHARACTERS);

export const studyTrackSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  type: educationContextSchema,
  programKey: z.string().nullable(),
  isPrimary: z.boolean(),
  status: z.enum(STUDY_TRACK_STATUSES),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type StudyTrack = z.infer<typeof studyTrackSchema>;

export const studyTrackResponseSchema = z.object({ studyTrack: studyTrackSchema });
export type StudyTrackResponse = z.infer<typeof studyTrackResponseSchema>;

/** The whole list, in the API's order: the primary first, then the active ones, then the archived, each by creation. */
export const studyTrackListResponseSchema = z.object({ studyTracks: z.array(studyTrackSchema) });
export type StudyTrackListResponse = z.infer<typeof studyTrackListResponseSchema>;

/**
 * Just enough of a study to say where something comes from ("Farmacología · Medicina"): never the owner or the status (a
 * study that is listed here is always active). Derived on every request, never stored next to the thing it labels.
 */
export const studyTrackRefSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  type: educationContextSchema,
  isPrimary: z.boolean(),
});
export type StudyTrackRef = z.infer<typeof studyTrackRefSchema>;

/**
 * One CURRENT, ACTIVE period with the study it belongs to (null for a general period). The summaries that answer "what needs my
 * attention now" read ALL of them (ordered: the general one, the primary study's, then the rest by the study's creation); the
 * HOME period is one of them, or none.
 */
export const currentPeriodContextSchema = z.object({
  period: periodSchema,
  studyTrack: studyTrackRefSchema.nullable(),
});
export type CurrentPeriodContext = z.infer<typeof currentPeriodContextSchema>;

/** GET /api/periods/current: every current, active period with its study, in the order above (empty when there is none). */
export const currentPeriodsResponseSchema = z.object({
  periods: z.array(currentPeriodContextSchema),
});
export type CurrentPeriodsResponse = z.infer<typeof currentPeriodsResponseSchema>;

type ProgramFields = { programKey?: string | null; name?: string };

/** A catalog key must exist, and a name sent with it must be exactly the catalog's canonical one (never "medicina" + "Derecho"). */
function checkProgram(v: ProgramFields, ctx: z.RefinementCtx) {
  if (typeof v.programKey !== 'string') return;
  const entry = findProgramByKey(v.programKey);
  if (!entry) {
    ctx.addIssue({ code: 'custom', path: ['programKey'], message: 'Programa no válido.' });
  } else if (typeof v.name === 'string' && v.name !== entry.name) {
    ctx.addIssue({
      code: 'custom',
      path: ['name'],
      message: 'El nombre no corresponde al programa elegido.',
    });
  }
}

const programKeyField = z
  .string()
  .max(STUDY_TRACK_KEY_MAX, 'Programa no válido.')
  .nullable()
  .optional();

/**
 * Strict: only these three fields. The owner, `isPrimary` and `status` are never the client's to say (the server decides
 * them), and neither is a period or a primary use. The name is required unless a catalog key brings the canonical one.
 */
const newTrackFields = {
  name: studyTrackNameSchema.optional(),
  type: educationContextSchema,
  programKey: programKeyField,
};

/** A NEW track needs a catalog key (which brings the canonical name) or a name of its own. */
function checkNewTrack(v: ProgramFields, ctx: z.RefinementCtx) {
  checkProgram(v, ctx);
  if (typeof v.programKey !== 'string' && v.name === undefined) {
    ctx.addIssue({ code: 'custom', path: ['name'], message: 'Ingresa el nombre del estudio.' });
  }
}

export const createStudyTrackSchema = z.strictObject(newTrackFields).superRefine(checkNewTrack);
export type CreateStudyTrackInput = z.infer<typeof createStudyTrackSchema>;
export type CreateStudyTrackRequest = z.input<typeof createStudyTrackSchema>;

/**
 * Partial and strict. Only what describes the study: archiving, restoring and choosing the primary one are separate actions
 * (they depend on the other tracks), so `status` and `isPrimary` are not accepted here.
 */
export const updateStudyTrackSchema = z
  .strictObject({
    name: studyTrackNameSchema.optional(),
    type: educationContextSchema.optional(),
    programKey: programKeyField,
  })
  .superRefine((v, ctx) => {
    if (Object.keys(v).length === 0) {
      ctx.addIssue({ code: 'custom', message: 'No hay nada que actualizar.' });
    }
    checkProgram(v, ctx);
  });
export type UpdateStudyTrackInput = z.infer<typeof updateStudyTrackSchema>;
export type UpdateStudyTrackRequest = z.input<typeof updateStudyTrackSchema>;

/** The name and key a NEW track gets: a catalog key brings its canonical name; otherwise the typed name, with no key. */
export function programOfNewTrack(input: Pick<CreateStudyTrackInput, 'name' | 'programKey'>): {
  programKey: string | null;
  name: string;
} {
  if (typeof input.programKey === 'string') {
    return { programKey: input.programKey, name: findProgramByKey(input.programKey)!.name };
  }
  return { programKey: null, name: input.name! };
}

/**
 * The name and key a track ends up with after applying `patch` (already validated) to what it has now. The name is ALWAYS
 * what is shown, and a key never survives a name it does not own:
 *  - a catalog key: the canonical name comes with it;
 *  - a different name: a study of their own, so the key is dropped;
 *  - the very same name with the key already there: nothing changes;
 *  - only `programKey: null`: detached from the catalog, the name stays as it is.
 */
export function resolveStudyTrackProgram(
  current: { programKey: string | null; name: string },
  patch: Pick<UpdateStudyTrackInput, 'name' | 'programKey'>,
): { programKey: string | null; name: string } {
  const { programKey, name } = patch;
  if (typeof programKey === 'string') {
    return { programKey, name: findProgramByKey(programKey)!.name };
  }
  if (name !== undefined) {
    if (programKey === undefined && current.programKey !== null && name === current.name) {
      return { programKey: current.programKey, name: current.name };
    }
    return { programKey: null, name };
  }
  if (programKey === null) return { programKey: null, name: current.name };
  return { programKey: current.programKey, name: current.name };
}

// ───────────────────────── Setup and adoption (P0.5-4) ─────────────────────────

/**
 * A study set up in ONE request: the study, its first period (current in its scope) and, optionally, its first subjects. All or
 * nothing. Strict at every level: the owner, `isPrimary`, `status`, a period id, a study id, an education context and colors are
 * never the client's to say (the server decides them: the first active study is the primary one, the subjects take the study's
 * type and the server's colors).
 */
export const setupStudyTrackSchema = z.strictObject({
  track: z.strictObject(newTrackFields).superRefine(checkNewTrack),
  period: studyPeriodSchema,
  subjects: z
    .array(subjectNameSchema)
    .max(SUBJECT_BATCH_MAX, `Máximo ${SUBJECT_BATCH_MAX} asignaturas a la vez.`)
    .optional(),
});
export type SetupStudyTrackInput = z.infer<typeof setupStudyTrackSchema>;
export type SetupStudyTrackRequest = z.input<typeof setupStudyTrackSchema>;

export const setupStudyTrackResponseSchema = z.object({
  studyTrack: studyTrackSchema,
  period: periodSchema,
  subjects: z.array(subjectSchema),
});
export type SetupStudyTrackResponse = z.infer<typeof setupStudyTrackResponseSchema>;

/**
 * Turns an EXISTING period of the user that belongs to no study into the first period of a NEW study, without copying anything
 * (the period keeps its id, dates, level, subjects, activities and schedule blocks). The same three fields as a new study plus
 * the period; the server checks that the period is the user's own and has no study.
 */
export const adoptPeriodSchema = z
  .strictObject({ periodId: z.uuid('Periodo inválido.'), ...newTrackFields })
  .superRefine(checkNewTrack);
export type AdoptPeriodInput = z.infer<typeof adoptPeriodSchema>;
export type AdoptPeriodRequest = z.input<typeof adoptPeriodSchema>;

export const adoptPeriodResponseSchema = z.object({
  studyTrack: studyTrackSchema,
  period: periodSchema,
});
export type AdoptPeriodResponse = z.infer<typeof adoptPeriodResponseSchema>;
