import { z } from 'zod';
import {
  INVALID_CHARACTERS,
  hasNoNul,
  normalizeNameKey,
  type EducationContext,
} from './academic.js';

/**
 * The educational PROFILE of a user: what the product may personalise later (labels, suggestions). It is a description,
 * never a permission: nothing here decides what a user can do, and no behaviour may depend on a particular value (no
 * `if (programKey === 'medicina')`). Identity and authentication stay in `User`.
 */

// ───────────────────────── Primary use ─────────────────────────

/** What the person says they use the app for. NOT an authorization role. */
export const PRIMARY_USES = [
  'UNIVERSITY_STUDENT',
  'SCHOOL_STUDENT',
  'OTHER_STUDENT',
  'TEACHER',
  'PERSONAL',
] as const;
export type PrimaryUse = (typeof PRIMARY_USES)[number];
export const PRIMARY_USE_LABELS: Record<PrimaryUse, string> = {
  UNIVERSITY_STUDENT: 'Estudio en la universidad',
  SCHOOL_STUDENT: 'Estudio en el colegio',
  OTHER_STUDENT: 'Estudio otra cosa (curso, idiomas…)',
  TEACHER: 'Soy docente',
  PERSONAL: 'Organización personal',
};

/**
 * The education context a NEW subject gets when nobody says one: a DEFAULT derived from what the person said they use the
 * app for, never an authority. Teachers and personal use study structured things elsewhere, so they get OTHER_ACADEMIC; `null`
 * (nothing answered, which is every older account) gives `null`: no context is invented. Changing `primaryUse` later never
 * touches subjects that already exist: it only changes this default.
 */
export function primaryUseToEducationContext(
  primaryUse: PrimaryUse | null | undefined,
): EducationContext | null {
  switch (primaryUse) {
    case 'UNIVERSITY_STUDENT':
      return 'UNIVERSITY';
    case 'SCHOOL_STUDENT':
      return 'SCHOOL';
    case 'OTHER_STUDENT':
    case 'TEACHER':
    case 'PERSONAL':
      return 'OTHER_ACADEMIC';
    default:
      return null;
  }
}

// ───────────────────────── Onboarding status ─────────────────────────

/**
 * NOT_STARTED: never answered anything. IN_PROGRESS: started. COMPLETED: finished on purpose. SKIPPED: chose to continue
 * without finishing (it can be reopened any time). No status blocks signing in or using the app.
 */
export const ONBOARDING_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED'] as const;
export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];

/** What a client may ask for: NOT_STARTED is only ever the initial state. */
export const REQUESTABLE_ONBOARDING_STATUSES = ['IN_PROGRESS', 'COMPLETED', 'SKIPPED'] as const;

const TRANSITIONS: Record<OnboardingStatus, readonly OnboardingStatus[]> = {
  NOT_STARTED: ['IN_PROGRESS', 'SKIPPED'],
  IN_PROGRESS: ['COMPLETED', 'SKIPPED'],
  // reopening: from either end the student can pick it up again
  SKIPPED: ['IN_PROGRESS'],
  COMPLETED: ['IN_PROGRESS'],
};

/** Asking for the state it already has is fine (idempotent); anything else must be one of the steps above. */
export const isOnboardingTransitionAllowed = (from: OnboardingStatus, to: OnboardingStatus) =>
  from === to || TRANSITIONS[from].includes(to);

// ───────────────────────── Program catalog ─────────────────────────

export const PROFILE_PROGRAM_NAME_MAX = 80;

export interface ProgramEntry {
  /** Stable, ASCII, lowercase: a reference that survives a rename of `name`. */
  key: string;
  /** The canonical name shown to the user and stored as `programName` when the entry is chosen. */
  name: string;
}

/**
 * A SMALL catalog of common programs, to make the usual answer one tap. It is an aid, not a list of everything that exists:
 * anything else is written by the person as a custom program (`programKey = null`). It is versioned with the code (no
 * network, no table); search it with `normalizeNameKey`.
 */
export const PROGRAM_CATALOG: readonly ProgramEntry[] = [
  { key: 'administracion-de-empresas', name: 'Administración de Empresas' },
  { key: 'arquitectura', name: 'Arquitectura' },
  { key: 'biologia', name: 'Biología' },
  { key: 'comunicacion-social', name: 'Comunicación Social' },
  { key: 'contaduria-publica', name: 'Contaduría Pública' },
  { key: 'derecho', name: 'Derecho' },
  { key: 'diseno-grafico', name: 'Diseño Gráfico' },
  { key: 'economia', name: 'Economía' },
  { key: 'educacion', name: 'Educación' },
  { key: 'enfermeria', name: 'Enfermería' },
  { key: 'fisioterapia', name: 'Fisioterapia' },
  { key: 'ingenieria-civil', name: 'Ingeniería Civil' },
  { key: 'ingenieria-de-sistemas', name: 'Ingeniería de Sistemas' },
  { key: 'ingenieria-industrial', name: 'Ingeniería Industrial' },
  { key: 'ingenieria-electronica', name: 'Ingeniería Electrónica' },
  { key: 'ingenieria-mecanica', name: 'Ingeniería Mecánica' },
  { key: 'licenciatura-en-idiomas', name: 'Licenciatura en Idiomas' },
  { key: 'medicina', name: 'Medicina' },
  { key: 'medicina-veterinaria', name: 'Medicina Veterinaria' },
  { key: 'nutricion-y-dietetica', name: 'Nutrición y Dietética' },
  { key: 'odontologia', name: 'Odontología' },
  { key: 'psicologia', name: 'Psicología' },
  { key: 'quimica', name: 'Química' },
  { key: 'quimica-farmaceutica', name: 'Química Farmacéutica' },
  { key: 'trabajo-social', name: 'Trabajo Social' },
];

const PROGRAM_BY_KEY: ReadonlyMap<string, ProgramEntry> = new Map(
  PROGRAM_CATALOG.map((p) => [p.key, p]),
);

/**
 * The catalog entries that match what the student typed, best first: case and accent insensitive (`normalizeNameKey`),
 * every typed word must appear (as the start of a word first, anywhere after). Nothing typed matches nothing: the catalog is
 * never dumped as a list. Pure and offline: a program the catalog does not have is simply written by the student.
 */
export function searchPrograms(query: string, limit = 6): ProgramEntry[] {
  const words = normalizeNameKey(query).split(' ').filter(Boolean);
  if (words.length === 0) return [];
  const scored: { entry: ProgramEntry; score: number }[] = [];
  for (const entry of PROGRAM_CATALOG) {
    const name = normalizeNameKey(entry.name);
    const nameWords = name.split(' ');
    if (!words.every((w) => name.includes(w))) continue;
    // 0: every typed word starts a word of the name (and the name starts with the first one); 1: starts words; 2: inside
    const startsWords = words.every((w) => nameWords.some((nw) => nw.startsWith(w)));
    const score = startsWords ? (name.startsWith(words[0]!) ? 0 : 1) : 2;
    scored.push({ entry, score });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.entry.name.localeCompare(b.entry.name, 'es'))
    .slice(0, limit)
    .map((s) => s.entry);
}

export const findProgramByKey = (key: string): ProgramEntry | undefined => PROGRAM_BY_KEY.get(key);

// ───────────────────────── Schemas ─────────────────────────

/** The program as the person wrote it (or the catalog's canonical name): trimmed, 1..80 characters, no NUL. */
export const programNameSchema = z
  .string({ error: 'Ingresa el nombre de la carrera o programa.' })
  .trim()
  .min(1, 'Ingresa el nombre de la carrera o programa.')
  .max(
    PROFILE_PROGRAM_NAME_MAX,
    `El nombre es demasiado largo (máximo ${PROFILE_PROGRAM_NAME_MAX} caracteres).`,
  )
  .refine(hasNoNul, INVALID_CHARACTERS);

export const profileSchema = z.object({
  primaryUse: z.enum(PRIMARY_USES).nullable(),
  programName: z.string().nullable(),
  programKey: z.string().nullable(),
  onboardingStatus: z.enum(ONBOARDING_STATUSES),
});
export type Profile = z.infer<typeof profileSchema>;
export const profileResponseSchema = z.object({ profile: profileSchema });
export type ProfileResponse = z.infer<typeof profileResponseSchema>;

/**
 * Partial and strict: only these four fields, and never an owner (it comes from the session). The program is a pair:
 *  - `programKey` (a catalog key): the name is the catalog's canonical one, derived by the server. A `programName` sent
 *    with it must be exactly that name.
 *  - a `programName` alone, or with `programKey: null`: a custom program (no key).
 *  - both `null`: clears the program.
 */
export const updateProfileSchema = z
  .strictObject({
    primaryUse: z.enum(PRIMARY_USES, { error: 'Elige una opción válida.' }).nullable().optional(),
    programKey: z.string().max(60, 'Programa no válido.').nullable().optional(),
    programName: programNameSchema.nullable().optional(),
    onboardingStatus: z
      .enum(REQUESTABLE_ONBOARDING_STATUSES, { error: 'Estado de onboarding no válido.' })
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (Object.keys(v).length === 0) {
      ctx.addIssue({ code: 'custom', message: 'No hay nada que actualizar.' });
    }
    if (typeof v.programKey === 'string') {
      const entry = findProgramByKey(v.programKey);
      if (!entry) {
        ctx.addIssue({ code: 'custom', path: ['programKey'], message: 'Programa no válido.' });
      } else if (v.programName === null) {
        ctx.addIssue({
          code: 'custom',
          path: ['programName'],
          message: 'Un programa del catálogo no puede quedar sin nombre.',
        });
      } else if (typeof v.programName === 'string' && v.programName !== entry.name) {
        ctx.addIssue({
          code: 'custom',
          path: ['programName'],
          message: 'El nombre no corresponde al programa elegido.',
        });
      }
    }
  });
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type UpdateProfileRequest = z.input<typeof updateProfileSchema>;

/**
 * The program the profile ends up with after applying `patch` (an already validated one) to what it has now. The name is
 * ALWAYS the authority: a key only ever points at a catalog entry whose canonical name is the stored name.
 */
export function resolveProgram(
  current: Pick<Profile, 'programKey' | 'programName'>,
  patch: Pick<UpdateProfileInput, 'programKey' | 'programName'>,
): Pick<Profile, 'programKey' | 'programName'> {
  const { programKey, programName } = patch;
  if (programKey === undefined && programName === undefined) return current;
  if (typeof programKey === 'string') {
    return { programKey, programName: findProgramByKey(programKey)!.name };
  }
  // A custom program, or none: a key never survives a name it does not own.
  if (programName !== undefined) return { programKey: null, programName };
  // only `programKey: null`: detach from the catalog and keep the name as a custom one
  return { programKey: null, programName: current.programName };
}
