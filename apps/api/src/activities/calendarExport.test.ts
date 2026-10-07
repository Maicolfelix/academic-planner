import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, postActivity, prisma, resetDb, setupUser } from '../../test/helpers.js';

const app = buildApp();

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const calendar = (agent: request.Agent, id: string) =>
  agent.get(`/api/activities/${id}/calendar.ics`);
const logical = (text: string) => text.replaceAll('\r\n ', '').split('\r\n').slice(0, -1);
const prop = (text: string, name: string) =>
  logical(text).find((l) => l.startsWith(`${name}:`) || l.startsWith(`${name};`));

async function owner() {
  const a = await setupUser(app, 'a@example.com', 'Bioestadística');
  const make = async (body: object) =>
    (await postActivity(a.agent, a.subject.id, body)).body.activity;
  return { ...a, make };
}

describe('GET /api/activities/:id/calendar.ics', () => {
  it('downloads a valid, CRLF-terminated .ics with the right headers', async () => {
    const a = await owner();
    const activity = await a.make({ title: 'Taller de Bioestadística', dueDate: '2026-10-23' });

    const res = await calendar(a.agent, activity.id);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/calendar; charset=utf-8');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="academic-planner-activity.ics"',
    );
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(res.text.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(res.text.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/);
    expect(res.text.split('\r\n').every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
  });

  it('an activity without a time is an all-day event on the user’s local day', async () => {
    const a = await owner();
    const activity = await a.make({ title: 'Taller de Bioestadística', dueDate: '2026-10-23' });

    const { text } = await calendar(a.agent, activity.id);

    expect(prop(text, 'DTSTART')).toBe('DTSTART;VALUE=DATE:20261023');
    expect(prop(text, 'DTEND')).toBe('DTEND;VALUE=DATE:20261024');
    expect(prop(text, 'SUMMARY')).toBe('SUMMARY:Taller de Bioestadística — Bioestadística');
    expect(prop(text, 'UID')).toBe(`UID:activity-${activity.id}`);
  });

  it('a timed activity is a 15-minute block that ends at dueAt (08:30 Bogotá = 13:30Z)', async () => {
    const a = await owner();
    const activity = await a.make({
      title: 'Parcial de Redes',
      dueDate: '2026-10-21',
      dueTime: '08:30',
    });

    const { text } = await calendar(a.agent, activity.id);

    expect(prop(text, 'DTSTART')).toBe('DTSTART:20261021T131500Z');
    expect(prop(text, 'DTEND')).toBe('DTEND:20261021T133000Z');
  });

  it('is deterministic: the same activity gives the same bytes, and an edit changes DTSTAMP', async () => {
    const a = await owner();
    const activity = await a.make({
      title: 'Parcial de Redes',
      dueDate: '2026-10-21',
      dueTime: '08:30',
    });

    const first = (await calendar(a.agent, activity.id)).text;
    const second = (await calendar(a.agent, activity.id)).text;
    expect(second).toBe(first);

    await a.agent.patch(`/api/activities/${activity.id}`).send({ title: 'Parcial 1 de Redes' });
    // DTSTAMP has seconds precision: an edit in the same second as the creation would not move it, so the
    // edit time is set explicitly (the point is that the stamp follows updatedAt, not the clock).
    await prisma.activity.update({
      where: { id: activity.id },
      data: { updatedAt: new Date('2099-01-02T03:04:05.678Z') },
    });
    const edited = (await calendar(a.agent, activity.id)).text;
    expect(prop(edited, 'UID')).toBe(prop(first, 'UID'));
    expect(prop(edited, 'DTSTAMP')).toBe('DTSTAMP:20990102T030405Z');
    expect(prop(edited, 'LAST-MODIFIED')).toBe('LAST-MODIFIED:20990102T030405Z');
    expect(prop(edited, 'SUMMARY')).toContain('Parcial 1 de Redes');
  });

  it('a completed activity can still be exported (it is a manual export, not a feed)', async () => {
    const a = await owner();
    const activity = await a.make({ title: 'Entrega', dueDate: '2026-10-23' });
    await a.agent.patch(`/api/activities/${activity.id}`).send({ status: 'COMPLETED' });

    const res = await calendar(a.agent, activity.id);

    expect(res.status).toBe(200);
    expect(prop(res.text, 'SUMMARY')).toContain('Entrega');
  });

  it('a malicious title cannot add properties or components', async () => {
    const a = await owner();
    const hostile = [
      'Parcial\r\nBEGIN:VEVENT\r\nUID:injected\r\nSUMMARY:pwned\r\nEND:VEVENT',
      'Parcial\r\nATTENDEE;CN=Atacante:mailto:atacante@example.test\r\nDESCRIPTION:falso',
      'Parcial\nMETHOD:PUBLISH',
    ];
    for (const title of hostile) {
      const activity = await a.make({ title });
      const { text, status } = await calendar(a.agent, activity.id);
      expect(status).toBe(200);
      const names = logical(text).map((l) => l.split(/[:;]/)[0]);
      expect(names.filter((n) => n === 'BEGIN')).toEqual(['BEGIN', 'BEGIN']);
      for (const forbidden of ['ATTENDEE', 'ORGANIZER', 'DESCRIPTION', 'METHOD']) {
        expect(names, forbidden).not.toContain(forbidden);
      }
      expect(logical(text).filter((l) => l.startsWith('UID:'))).toEqual([
        `UID:activity-${activity.id}`,
      ]);
    }
  });

  it('writes only the title, the subject name and the dates: no description, e-mail, user name or ids', async () => {
    const a = await owner();
    const activity = await a.make({
      title: 'Taller',
      description: 'texto-privado-de-la-descripcion',
      priority: 'HIGH',
      type: 'EXAM',
    });

    const { text } = await calendar(a.agent, activity.id);

    for (const secret of [
      'texto-privado-de-la-descripcion',
      'a@example.com',
      'Test User',
      a.subject.id,
      'HIGH',
      'EXAM',
      'PENDING',
    ]) {
      expect(text, secret).not.toContain(secret);
    }
    expect(logical(text).map((l) => l.split(/[:;]/)[0])).toEqual([
      'BEGIN',
      'VERSION',
      'PRODID',
      'CALSCALE',
      'BEGIN',
      'UID',
      'DTSTAMP',
      'LAST-MODIFIED',
      'DTSTART',
      'DTEND',
      'SUMMARY',
      'TRANSP',
      'END',
      'END',
    ]);
  });

  it('a foreign activity and a missing one are the very same 404', async () => {
    const a = await owner();
    const b = await setupUser(app, 'b@example.com', 'Materia B');
    const foreign = (await postActivity(b.agent, b.subject.id, { title: 'De B' })).body.activity;

    const mine = await calendar(a.agent, foreign.id);
    const missing = await calendar(a.agent, randomUUID());
    const garbage = await calendar(a.agent, 'not-a-uuid');

    expect(mine.status).toBe(404);
    expect({ status: mine.status, body: mine.body }).toEqual({
      status: missing.status,
      body: missing.body,
    });
    expect(garbage.status).toBe(404);
    expect(garbage.body).toEqual(missing.body);
    expect(mine.text).not.toContain('BEGIN:VCALENDAR');
    expect(mine.headers['content-disposition']).toBeUndefined();
  });

  it('refuses an anonymous caller with the usual 401', async () => {
    const a = await owner();
    const activity = await a.make({ title: 'Taller' });

    const res = await request(app).get(`/api/activities/${activity.id}/calendar.ics`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(res.headers['content-type']).toContain('application/json');
  });

  it('does not change anything in the database', async () => {
    const a = await owner();
    const activity = await a.make({ title: 'Taller' });
    const before = {
      activities: await prisma.activity.findMany(),
      reminders: await prisma.reminder.findMany(),
    };

    await calendar(a.agent, activity.id);

    expect({
      activities: await prisma.activity.findMany(),
      reminders: await prisma.reminder.findMany(),
    }).toEqual(before);
  });
});
