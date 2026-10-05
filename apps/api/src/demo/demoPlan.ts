import {
  SUBJECT_COLOR_VALUES,
  addDays,
  firstWeekdayOnOrAfter,
  toLocalParts,
  weekRangeOf,
  type ActivityPriority,
  type ActivityStatus,
  type ActivityType,
  type SubjectColor,
  type DateOnly,
  type Weekday,
} from '@planner/core';

/**
 * The demonstration dataset as PURE DATA: nothing here touches a database or a clock. `buildDemoPlan(now)`
 * turns offsets relative to `now` into concrete local dates, so the demo is as useful next year as today.
 * Only persisted entities are described; Radar band, attention, progress, workload and reminders are DERIVED by
 * the real rules (the seed never writes them). See docs/demo.md.
 */

export const DEMO_EMAIL = 'demo@academicplanner.local';
export const DEMO_NAME = 'Estudiante Demo';
/** Synthetic, local-only credential, documented in docs/demo.md. Never use it in a public deployment. */
export const DEMO_PASSWORD = 'DemoAcademic2026!';
export const DEMO_TIMEZONE = 'America/Bogota';

const HOUR_MS = 3_600_000;

interface SubjectSeed {
  name: string;
  professor?: string;
  description?: string;
}

/** Six clearly different names; some with a professor / description and some without, on purpose. */
const SUBJECTS: readonly SubjectSeed[] = [
  {
    name: 'Redes de Computadores',
    professor: 'Laura Martínez',
    description: 'Modelo OSI, direccionamiento IP y subredes.',
  },
  { name: 'Bases de Datos', professor: 'Carlos Pineda' },
  { name: 'Bioestadística' },
  {
    name: 'Epidemiología',
    professor: 'Marta Salcedo',
    description: 'Medidas de frecuencia y diseño de estudios.',
  },
  { name: 'Programación Web', professor: 'Andrés Quintero' },
  { name: 'Seguridad Informática' },
];

interface ClassSeed {
  subject: string;
  weekday: Weekday;
  startTime: string;
  endTime: string;
}

/** A believable week that does not fill every day: three mornings and three afternoons, no overlap. */
const CLASSES: readonly ClassSeed[] = [
  { subject: 'Redes de Computadores', weekday: 1, startTime: '08:00', endTime: '10:00' },
  { subject: 'Bioestadística', weekday: 1, startTime: '14:00', endTime: '16:00' },
  { subject: 'Bases de Datos', weekday: 2, startTime: '10:00', endTime: '12:00' },
  { subject: 'Epidemiología', weekday: 3, startTime: '08:00', endTime: '10:00' },
  { subject: 'Programación Web', weekday: 4, startTime: '14:00', endTime: '16:00' },
  { subject: 'Seguridad Informática', weekday: 5, startTime: '10:00', endTime: '12:00' },
];

export interface ActivitySeed {
  subject: string;
  title: string;
  description?: string;
  type: ActivityType;
  priority: ActivityPriority;
  status: ActivityStatus;
  /** Deadline, in hours from `now` (negative = in the past). */
  dueInHours: number;
  /** When the student "registered" it, in hours from `now` (negative). Reminders are computed from this moment. */
  createdInHours: number;
  /** Only for COMPLETED: when it was finished, in hours from `now` (negative, after creation). */
  completedInHours?: number;
}

/**
 * 15 activities. The design target (each one checked by demoSeed.test.ts):
 *  - Radar: 1 overdue, 2 immediate, 2 upcoming, 3 plannable, 3 under control, 4 completed.
 *  - "¿Qué hago ahora?": Parcial 1 de Redes (HIGH + IMMEDIATE) leads. A finite overdue (<= 7 days) would outrank
 *    it by design (see attention.ts), so the one overdue activity is MORE than 7 days late: it stays visible in
 *    the Radar and the Attention alternatives without dominating the recommendation.
 *  - Progress 4 / 15 = 27 %: Redes 2/4, Bases 1/3, Bioestadística 1/3, Epidemiología 0/2, Web 0/2, Seguridad 0/1.
 */
export const ACTIVITIES: readonly ActivitySeed[] = [
  {
    subject: 'Redes de Computadores',
    title: 'Parcial 1 de Redes',
    description: 'Capas del modelo OSI, direccionamiento IPv4 y subredes.',
    type: 'EXAM',
    priority: 'HIGH',
    status: 'PENDING',
    dueInHours: 6,
    createdInHours: -48,
  },
  {
    subject: 'Redes de Computadores',
    title: 'Taller de subredes IPv4',
    type: 'WORKSHOP',
    priority: 'MEDIUM',
    status: 'IN_PROGRESS',
    dueInHours: 48,
    createdInHours: -96,
  },
  {
    subject: 'Redes de Computadores',
    title: 'Lectura sobre el modelo OSI',
    type: 'READING',
    priority: 'LOW',
    status: 'COMPLETED',
    dueInHours: -72,
    createdInHours: -192,
    completedInHours: -96,
  },
  {
    subject: 'Redes de Computadores',
    title: 'Quiz de direccionamiento IP',
    type: 'QUIZ',
    priority: 'MEDIUM',
    status: 'COMPLETED',
    dueInHours: -144,
    createdInHours: -240,
    completedInHours: -150,
  },
  {
    subject: 'Bases de Datos',
    title: 'Taller de consultas SQL',
    description: 'Consultas con JOIN y agrupaciones sobre la base de la universidad.',
    type: 'WORKSHOP',
    priority: 'MEDIUM',
    status: 'PENDING',
    dueInHours: 120,
    createdInHours: -48,
  },
  {
    subject: 'Bases de Datos',
    title: 'Quiz de normalización',
    type: 'QUIZ',
    priority: 'MEDIUM',
    status: 'COMPLETED',
    dueInHours: -24,
    createdInHours: -168,
    completedInHours: -30,
  },
  {
    subject: 'Bases de Datos',
    title: 'Proyecto final de bases de datos',
    description: 'Modelo entidad-relación, esquema y consultas de la aplicación.',
    type: 'PROJECT',
    priority: 'HIGH',
    status: 'PENDING',
    dueInHours: 336,
    createdInHours: -240,
  },
  {
    subject: 'Bioestadística',
    title: 'Quiz de distribuciones de probabilidad',
    type: 'QUIZ',
    priority: 'MEDIUM',
    status: 'PENDING',
    dueInHours: 60,
    createdInHours: -48,
  },
  {
    subject: 'Bioestadística',
    title: 'Informe de práctica estadística',
    type: 'TASK',
    priority: 'LOW',
    status: 'PENDING',
    dueInHours: -216,
    createdInHours: -312,
  },
  {
    subject: 'Bioestadística',
    title: 'Taller de medidas de tendencia central',
    type: 'WORKSHOP',
    priority: 'LOW',
    status: 'COMPLETED',
    dueInHours: -120,
    createdInHours: -216,
    completedInHours: -125,
  },
  {
    subject: 'Epidemiología',
    title: 'Lectura sobre medidas de frecuencia',
    type: 'READING',
    priority: 'MEDIUM',
    status: 'IN_PROGRESS',
    dueInHours: 96,
    createdInHours: -48,
  },
  {
    subject: 'Epidemiología',
    title: 'Quiz de epidemiología',
    type: 'QUIZ',
    priority: 'LOW',
    status: 'PENDING',
    dueInHours: 216,
    createdInHours: -48,
  },
  {
    subject: 'Programación Web',
    title: 'Presentación del proyecto web',
    description: 'Demostración de 10 minutos con el prototipo funcionando.',
    type: 'PRESENTATION',
    priority: 'HIGH',
    status: 'PENDING',
    dueInHours: 144,
    createdInHours: -120,
  },
  {
    subject: 'Programación Web',
    title: 'Tarea de formularios y validación',
    type: 'TASK',
    priority: 'MEDIUM',
    status: 'IN_PROGRESS',
    dueInHours: 20,
    createdInHours: -48,
  },
  {
    subject: 'Seguridad Informática',
    title: 'Informe de seguridad informática',
    type: 'TASK',
    priority: 'MEDIUM',
    status: 'PENDING',
    dueInHours: 288,
    createdInHours: -48,
  },
];

/** The one MANUAL reminder: two days before the presentation, at 8:00 (a future, valid time). */
export const MANUAL_REMINDER_ACTIVITY = 'Presentación del proyecto web';
export const MANUAL_REMINDER_DAYS_BEFORE = 2;
export const MANUAL_REMINDER_TIME = '08:00';

export interface DemoPlan {
  period: { name: string; startDate: DateOnly; endDate: DateOnly };
  subjects: { name: string; color: SubjectColor; professor?: string; description?: string }[];
  classes: (ClassSeed & { title: string; date: DateOnly; until: DateOnly })[];
  activities: (ActivitySeed & {
    dueAt: Date;
    createdAt: Date;
    completedAt?: Date;
    /** Local "YYYY-MM-DD" / "HH:mm" the activity service is given. */
    dueDate: DateOnly;
    dueTime: string;
  })[];
}

/** Rounds UP to the next quarter hour, so a deadline never lands earlier than designed and reads naturally. */
const quarterUp = (instant: Date) => new Date(Math.ceil(instant.getTime() / 900_000) * 900_000);

const at = (now: Date, hours: number) => new Date(now.getTime() + hours * HOUR_MS);

/**
 * `now` is read ONCE by the caller and passed in: every date below derives from that single instant, so a seed
 * that runs at 23:59:59 cannot straddle two moments. The period starts on the Monday five weeks before `now`
 * (local week, Monday to Sunday) and lasts 17 weeks, leaving about 12 weeks ahead.
 */
export function buildDemoPlan(now: Date, timezone = DEMO_TIMEZONE): DemoPlan {
  const today = toLocalParts(now, timezone).date;
  const startDate = addDays(weekRangeOf(today).from, -5 * 7);
  const endDate = addDays(startDate, 17 * 7 - 1);
  const year = Number(today.slice(0, 4));
  const half = Number(today.slice(5, 7)) <= 6 ? 'I' : 'II';

  return {
    period: { name: `Semestre demo ${year}-${half}`, startDate, endDate },
    subjects: SUBJECTS.map((s, i) => ({ ...s, color: SUBJECT_COLOR_VALUES[i]! })),
    classes: CLASSES.map((c) => ({
      ...c,
      title: c.subject,
      date: firstWeekdayOnOrAfter(startDate, c.weekday),
      until: endDate,
    })),
    activities: ACTIVITIES.map((a) => {
      const dueAt = quarterUp(at(now, a.dueInHours));
      const local = toLocalParts(dueAt, timezone);
      return {
        ...a,
        dueAt,
        createdAt: at(now, a.createdInHours),
        ...(a.completedInHours !== undefined && { completedAt: at(now, a.completedInHours) }),
        dueDate: local.date,
        dueTime: local.time,
      };
    }),
  };
}
