import type { Db } from '../db/prisma.js';
import type { EducationContext } from '../generated/prisma/client.js';
import { fromDateOnly } from '../mappers.js';

export interface PeriodData {
  name?: string;
  startDate?: string;
  endDate?: string;
  /** Already resolved by the service (a number or a note, never both); undefined = unchanged. */
  studyLevel?: number | null;
  studyLevelNote?: string | null;
  /** A study (already checked: the user's own and active) or null = general; undefined = unchanged. */
  studyTrackId?: string | null;
}

const dates = (d: PeriodData) => ({
  ...(d.name !== undefined && { name: d.name }),
  ...(d.startDate !== undefined && { startDate: fromDateOnly(d.startDate) }),
  ...(d.endDate !== undefined && { endDate: fromDateOnly(d.endDate) }),
  ...(d.studyLevel !== undefined && { studyLevel: d.studyLevel }),
  ...(d.studyLevelNote !== undefined && { studyLevelNote: d.studyLevelNote }),
  ...(d.studyTrackId !== undefined && { studyTrackId: d.studyTrackId }),
});

/**
 * THE period lookups. They accept a transaction client too, so a write that runs in one transaction (the schedule import
 * confirmation, the capture confirmation, the quick batch) reads the period through the same connection.
 *
 * "Current" is no longer ONE period per user: it is one per SCOPE, where a scope is "no study" (a general period) or one study.
 * So there is deliberately no lookup called "the current period": a caller says WHICH one it wants.
 *  - `findHomeCurrent`: the single period the code that has not learned about several studies yet keeps using (see below);
 *  - `findCurrentUntracked` / `findCurrentForTrack`: the current one of exactly one scope;
 *  - `listCurrent`: every current period (the future multi-period reads).
 */
export function createPeriodLookup(db: Db) {
  return {
    findOwned: (userId: string, id: string) =>
      db.academicPeriod.findFirst({ where: { id, userId } }),

    /**
     * The HOME current period: an exact, deterministic rule, never "whichever is current" or "the newest":
     *  1. the user's current period WITHOUT a study, if there is one;
     *  2. otherwise the current period of the PRIMARY study, if that study is ACTIVE;
     *  3. otherwise none.
     * A secondary study's current period is never the home one. One query: at most two rows can match (one general current
     * and the primary study's current) and the general one sorts first.
     */
    findHomeCurrent: (userId: string) =>
      db.academicPeriod.findFirst({
        where: {
          userId,
          isCurrent: true,
          OR: [{ studyTrackId: null }, { studyTrack: { isPrimary: true, status: 'ACTIVE' } }],
        },
        orderBy: { studyTrackId: { sort: 'asc', nulls: 'first' } },
      }),

    /** The current period that belongs to no study (at most one per user, by the database). */
    findCurrentUntracked: (userId: string) =>
      db.academicPeriod.findFirst({ where: { userId, isCurrent: true, studyTrackId: null } }),

    /** The current period of one study (at most one per study, by the database). */
    findCurrentForTrack: (userId: string, studyTrackId: string) =>
      db.academicPeriod.findFirst({ where: { userId, isCurrent: true, studyTrackId } }),

    /**
     * Every current period the user can read today: the general one (if any) and the one of each ACTIVE study. The current
     * period of an ARCHIVED study is never listed. Order: the general one first, then the primary study's, then the rest by
     * the study's creation (the id breaks ties), so it is the same on every call.
     */
    async listCurrent(userId: string) {
      const rows = await db.academicPeriod.findMany({
        where: {
          userId,
          isCurrent: true,
          OR: [{ studyTrackId: null }, { studyTrack: { status: 'ACTIVE' } }],
        },
        include: { studyTrack: { select: { id: true, isPrimary: true, createdAt: true } } },
      });
      const rank = (t: (typeof rows)[number]['studyTrack']) =>
        t === null ? 0 : t.isPrimary ? 1 : 2;
      rows.sort(
        (a, b) =>
          rank(a.studyTrack) - rank(b.studyTrack) ||
          (a.studyTrack?.createdAt.getTime() ?? 0) - (b.studyTrack?.createdAt.getTime() ?? 0) ||
          (a.studyTrack?.id ?? '').localeCompare(b.studyTrack?.id ?? '') ||
          a.id.localeCompare(b.id),
      );
      return rows.map(({ studyTrack: _studyTrack, ...period }) => period);
    },

    /**
     * The type of the study a period belongs to (the DEFAULT context of a NEW subject created in it), or null when the period
     * has no study. The period must be the user's own, so another user's period answers null as if it had none.
     */
    async studyTrackTypeOf(userId: string, periodId: string): Promise<EducationContext | null> {
      const row = await db.academicPeriod.findFirst({
        where: { id: periodId, userId },
        select: { studyTrack: { select: { type: true } } },
      });
      return row?.studyTrack?.type ?? null;
    },
  };
}

export type PeriodLookup = ReturnType<typeof createPeriodLookup>;

/**
 * Every query is scoped by userId: a period id alone never reaches data. Accepts a transaction client; the service decides
 * what runs in a transaction (it takes the per-user lock first).
 */
export function createPeriodRepository(db: Db) {
  return {
    ...createPeriodLookup(db),

    list: (userId: string) =>
      db.academicPeriod.findMany({
        where: { userId },
        orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
      }),

    /** Is there already a current period in this scope (`null` = the general one, or one study)? */
    hasCurrentInScope: async (userId: string, studyTrackId: string | null) =>
      (await db.academicPeriod.count({ where: { userId, isCurrent: true, studyTrackId } })) > 0,

    /** The current period of a scope other than `exceptId`, if any. */
    otherCurrentInScope: (userId: string, studyTrackId: string | null, exceptId: string) =>
      db.academicPeriod.findFirst({
        where: { userId, isCurrent: true, studyTrackId, id: { not: exceptId } },
      }),

    /** Un-marks the current period of ONE scope (never another scope's), except `exceptId`. */
    demoteCurrentInScope: (userId: string, studyTrackId: string | null, exceptId?: string) =>
      db.academicPeriod.updateMany({
        where: {
          userId,
          isCurrent: true,
          studyTrackId,
          ...(exceptId !== undefined && { id: { not: exceptId } }),
        },
        data: { isCurrent: false },
      }),

    insert: (
      userId: string,
      data: Required<Pick<PeriodData, 'name' | 'startDate' | 'endDate'>> & PeriodData,
      isCurrent: boolean,
    ) =>
      db.academicPeriod.create({
        data: {
          userId,
          name: data.name,
          startDate: fromDateOnly(data.startDate),
          endDate: fromDateOnly(data.endDate),
          studyLevel: data.studyLevel ?? null,
          studyLevelNote: data.studyLevelNote ?? null,
          studyTrackId: data.studyTrackId ?? null,
          isCurrent,
        },
      }),

    /** `where: { id, userId }` makes ownership part of the write itself (P2025 when it is not yours). */
    update: (userId: string, id: string, data: PeriodData, makeCurrent: boolean) =>
      db.academicPeriod.update({
        where: { id, userId },
        data: { ...dates(data), ...(makeCurrent && { isCurrent: true }) },
      }),

    countSubjects: (periodId: string) => db.subject.count({ where: { periodId } }),

    countScheduleBlocks: (periodId: string) => db.scheduleBlock.count({ where: { periodId } }),

    /** Every activity of the period, with or without a subject (a general activity has no subject to count it by). */
    countActivities: (periodId: string) => db.activity.count({ where: { periodId } }),

    delete: async (userId: string, id: string) =>
      (await db.academicPeriod.deleteMany({ where: { id, userId } })).count > 0,
  };
}

export type PeriodRepository = ReturnType<typeof createPeriodRepository>;
