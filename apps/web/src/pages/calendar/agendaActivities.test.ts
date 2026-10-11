import type { Activity } from '@planner/core';
import { describe, expect, it } from 'vitest';
import { agendaActivities, agendaActivityLabel } from './agendaActivities';

const TZ = 'America/Bogota';
// Sunday 11 October 2026, 15:00 in Bogotá
const NOW = new Date('2026-10-11T20:00:00.000Z');

let n = 0;
const activity = (over: Partial<Activity> & { dueAt: string }): Activity => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  subjectId: null,
  title: `Actividad ${n}`,
  description: null,
  type: 'TASK',
  priority: 'MEDIUM',
  status: 'PENDING',
  hasTime: true,
  completedAt: null,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  ...over,
});

describe('the activities of the Agenda', () => {
  it('an activity with an hour is drawn on its local day at that hour', () => {
    // Tuesday 13 October, 14:00 in Bogotá = 19:00 UTC
    const [a] = agendaActivities([activity({ dueAt: '2026-10-13T19:00:00.000Z' })], TZ, NOW);
    expect(a).toMatchObject({ date: '2026-10-13', time: '14:00', overdue: false });
  });

  it('the local day, not the UTC one: 8 p. m. in Bogotá is already the next day in UTC', () => {
    const [a] = agendaActivities([activity({ dueAt: '2026-10-14T01:30:00.000Z' })], TZ, NOW);
    expect(a).toMatchObject({ date: '2026-10-13', time: '20:30' });
  });

  it('one with no hour keeps its day and has no time ("Sin hora")', () => {
    // no hour = due at the end of the local day
    const [a] = agendaActivities(
      [activity({ dueAt: '2026-10-14T04:59:59.999Z', hasTime: false })],
      TZ,
      NOW,
    );
    expect(a).toMatchObject({ date: '2026-10-13', time: null });
  });

  it('finished activities are not drawn; pending and in progress are', () => {
    const items = agendaActivities(
      [
        activity({ dueAt: '2026-10-13T19:00:00.000Z', status: 'COMPLETED' }),
        activity({ dueAt: '2026-10-13T19:00:00.000Z', status: 'IN_PROGRESS' }),
        activity({ dueAt: '2026-10-13T20:00:00.000Z', status: 'PENDING' }),
      ],
      TZ,
      NOW,
    );
    expect(items.map((i) => i.activity.status)).toEqual(['IN_PROGRESS', 'PENDING']);
  });

  it('an open activity whose deadline passed stays on the day it was due, marked overdue', () => {
    const [a] = agendaActivities([activity({ dueAt: '2026-10-08T15:00:00.000Z' })], TZ, NOW);
    expect(a).toMatchObject({ date: '2026-10-08', time: '10:00', overdue: true });
  });

  it('an activity due later today is not overdue yet; one with no hour is only overdue after its day', () => {
    const items = agendaActivities(
      [
        activity({ dueAt: '2026-10-11T22:00:00.000Z' }),
        activity({ dueAt: '2026-10-12T04:59:59.999Z', hasTime: false }),
      ],
      TZ,
      NOW,
    );
    expect(items.map((i) => i.overdue)).toEqual([false, false]);
  });

  it('order: by day, the ones with no hour first, then by hour, then by title', () => {
    const items = agendaActivities(
      [
        activity({ title: 'C', dueAt: '2026-10-13T21:00:00.000Z' }),
        activity({ title: 'B', dueAt: '2026-10-14T04:59:59.999Z', hasTime: false }),
        activity({ title: 'A', dueAt: '2026-10-13T13:00:00.000Z' }),
        activity({ title: 'D', dueAt: '2026-10-12T13:00:00.000Z' }),
      ],
      TZ,
      NOW,
    );
    expect(items.map((i) => i.activity.title)).toEqual(['D', 'B', 'A', 'C']);
  });

  it('what a screen reader hears says it is an activity, the day, the hour and whether it is overdue', () => {
    const [a] = agendaActivities(
      [activity({ title: 'Parcial de redes', type: 'EXAM', dueAt: '2026-10-08T15:00:00.000Z' })],
      TZ,
      NOW,
    );
    expect(agendaActivityLabel(a!, 'jueves', TZ)).toBe(
      'Parcial de redes, actividad (parcial), jueves, 10:00 a. m., vencida',
    );
    const [b] = agendaActivities(
      [activity({ title: 'Lectura', dueAt: '2026-10-14T04:59:59.999Z', hasTime: false })],
      TZ,
      NOW,
    );
    expect(agendaActivityLabel(b!, 'martes', TZ)).toBe(
      'Lectura, actividad (tarea), martes, sin hora',
    );
  });
});
