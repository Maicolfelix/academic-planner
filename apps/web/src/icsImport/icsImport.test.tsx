import type { IcsParseResponse, IcsProposal } from '@planner/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IcsRowCard } from '../pages/icsImport/IcsRowCard';
import {
  buildConfirmRequest,
  canConfirm,
  confirmLabel,
  createRows,
  createdMessage,
  patchRow,
  removeRows,
  setErrors,
  setKind,
  subjectOptions,
  summarize,
} from './icsReviewModel';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ING = { id: U(1), name: 'Ciberseguridad', periodId: U(10), studyName: 'Ingeniería' };
const DIP = { id: U(2), name: 'Ciberseguridad', periodId: U(11), studyName: 'Diplomado' };
const OTHER = { id: U(3), name: 'Cálculo', periodId: U(10), studyName: 'Ingeniería' };

const proposal = (over: Partial<IcsProposal> = {}): IcsProposal => ({
  clientId: 'a',
  sourceUid: null,
  sourceTitle: 'Parcial Ciberseguridad',
  kindProposal: 'ACTIVITY',
  status: 'READY',
  reason: null,
  title: 'Parcial Ciberseguridad',
  description: null,
  type: 'EXAM',
  subject: { kind: 'EXISTING', id: ING.id, name: ING.name, periodId: ING.periodId },
  date: '2026-10-23',
  startTime: '10:00',
  endTime: null,
  allDay: false,
  repeats: 'NONE',
  until: null,
  exceptions: 0,
  warnings: [],
  blocking: [],
  duplicateOf: null,
  selected: true,
  ...over,
});
const weekly = (over: Partial<IcsProposal> = {}) =>
  proposal({
    clientId: 'w',
    sourceTitle: 'Ciberseguridad',
    title: 'Ciberseguridad',
    kindProposal: 'SCHEDULE_BLOCK',
    type: 'OTHER',
    date: '2026-10-20',
    startTime: '07:00',
    endTime: '09:00',
    repeats: 'WEEKLY',
    ...over,
  });
const parsed = (...ps: IcsProposal[]): Pick<IcsParseResponse, 'proposals'> => ({ proposals: ps });
const card = (row: ReturnType<typeof createRows>[number], subjects = [ING, DIP]) =>
  renderToStaticMarkup(
    <IcsRowCard
      row={row}
      subjects={subjects}
      disabled={false}
      onPatch={() => undefined}
      onKind={() => undefined}
      onRemove={() => undefined}
    />,
  );

describe('ics review model', () => {
  it('starts from the engine: kind, title, subject, selection', () => {
    const [a, w] = createRows(parsed(proposal(), weekly()));
    expect([a!.kind, a!.selected, a!.subjectId]).toEqual(['ACTIVITY', true, ING.id]);
    expect([w!.kind, w!.endTime]).toEqual(['BLOCK', '09:00']);
  });

  it('never selects an unsupported event', () => {
    const [u] = createRows(parsed(proposal({ kindProposal: 'UNSUPPORTED', reason: 'x' })));
    expect([u!.kind, u!.selected]).toEqual(['SKIP', false]);
  });

  it('an ambiguous subject offers only its candidates and blocks until chosen', () => {
    const p = proposal({
      subject: {
        kind: 'AMBIGUOUS',
        candidates: [
          { id: ING.id, name: ING.name, periodId: ING.periodId },
          { id: DIP.id, name: DIP.name, periodId: DIP.periodId },
        ],
      },
      status: 'NEEDS_REVIEW',
    });
    const [row] = createRows(parsed(p));
    expect(subjectOptions(row!, [ING, DIP, OTHER]).map((s) => s.id)).toEqual([ING.id, DIP.id]);
    expect(summarize([row!])).toMatchObject({ toCreate: 0, incomplete: 1 });
    const chosen = patchRow([row!], 'a', { subjectId: DIP.id });
    expect(summarize(chosen).toCreate).toBe(1);
  });

  it('a weekly class without end time waits for one; an end before the start is not valid', () => {
    const [row] = createRows(parsed(weekly({ endTime: null })));
    expect(summarize([row!]).incomplete).toBe(1);
    expect(summarize(patchRow([row!], 'w', { endTime: '06:00' })).incomplete).toBe(1);
    expect(summarize(patchRow([row!], 'w', { endTime: '09:00' })).toCreate).toBe(1);
  });

  it('exceptions are never ignored silently: undecided blocks everything, each choice resolves differently', () => {
    const rows = createRows(parsed(proposal(), weekly({ exceptions: 2 })));
    expect(rows[1]!.exceptionChoice).toBe('UNDECIDED');
    expect(summarize(rows)).toMatchObject({ toCreate: 1, incomplete: 1 });
    expect(canConfirm(rows)).toBe(false);
    expect(buildConfirmRequest(rows)).toBeNull();
    expect(confirmLabel(summarize(rows))).toBe('Resolver antes de importar');
    const series = patchRow(rows, 'w', { exceptionChoice: 'SERIES' });
    expect(buildConfirmRequest(series)!.items[1]).toMatchObject({ weekly: true });
    const single = patchRow(rows, 'w', { exceptionChoice: 'SINGLE' });
    expect(buildConfirmRequest(single)!.items[1]).toMatchObject({ weekly: false });
    // "No importar" through the exception question stops blocking: only the activity goes.
    const skip = patchRow(rows, 'w', { exceptionChoice: 'SKIP' });
    expect(buildConfirmRequest(skip)!.items.map((i) => i.clientId)).toEqual(['a']);
    expect(confirmLabel(summarize(skip))).toBe('Importar 1 actividad');
  });

  it('any ticked unresolved row blocks the whole confirmation: no silent partial request', () => {
    const rows = createRows(parsed(proposal(), weekly({ endTime: null })));
    expect(summarize(rows)).toMatchObject({ toCreate: 1, incomplete: 1 });
    expect(canConfirm(rows)).toBe(false);
    expect(buildConfirmRequest(rows)).toBeNull();
    expect(confirmLabel(summarize(rows))).toBe('Resolver antes de importar');
    // Resolving it releases ONE request with both.
    const solved = patchRow(rows, 'w', { endTime: '09:00' });
    expect(canConfirm(solved)).toBe(true);
    expect(confirmLabel(summarize(solved))).toBe('Importar 1 actividad y 1 clase');
    expect(buildConfirmRequest(solved)!.items).toHaveLength(2);
  });

  it('unticked or "No importar" rows never block, however unfinished they are', () => {
    const rows = createRows(parsed(proposal(), weekly({ endTime: null })));
    const unticked = patchRow(rows, 'w', { selected: false });
    expect(buildConfirmRequest(unticked)!.items.map((i) => i.clientId)).toEqual(['a']);
    expect(confirmLabel(summarize(unticked))).toBe('Importar 1 actividad');
    const skipped = setKind(rows, 'w', 'SKIP');
    expect(buildConfirmRequest(skipped)!.items.map((i) => i.clientId)).toEqual(['a']);
  });

  it('nothing ticked: nothing to import, no request', () => {
    const rows = setKind(createRows(parsed(proposal())), 'a', 'SKIP');
    expect(buildConfirmRequest(rows)).toBeNull();
    expect(confirmLabel(summarize(rows))).toBe('Nada que importar');
  });

  it('the request carries everything ticked and complete', () => {
    const rows = createRows(parsed(proposal(), weekly()));
    const req = buildConfirmRequest(rows)!;
    expect(req.items).toHaveLength(2);
    expect(req.items[0]).toMatchObject({ kind: 'ACTIVITY', subjectId: ING.id, date: '2026-10-23' });
  });

  it('labels the single confirmation with what it will create', () => {
    const rows = createRows(parsed(proposal(), weekly(), proposal({ clientId: 'b' })));
    expect(confirmLabel(summarize(rows))).toBe('Importar 2 actividades y 1 clase');
    expect(confirmLabel(summarize([]))).toBe('Nada que importar');
    expect(confirmLabel(summarize(rows), true)).toBe('Importando…');
  });

  it('removes rows and keeps server errors on their card', () => {
    const rows = createRows(parsed(proposal(), weekly()));
    expect(removeRows(rows, new Set(['a'])).map((r) => r.proposal.clientId)).toEqual(['w']);
    expect(setErrors(rows, { a: 'Falló' })[0]!.error).toBe('Falló');
  });

  it('success message', () => {
    expect(createdMessage({ activities: 2, blocks: 1, reused: 0 })).toBe(
      '2 actividades creadas y 1 clase creada.',
    );
  });
});

describe('IcsRowCard', () => {
  it('shows kind, title and subject as labelled controls with study names; no raw ics', () => {
    const html = card(createRows(parsed(proposal()))[0]!);
    expect(html).toContain('Actividad');
    expect(html).toContain('Clase / horario');
    expect(html).toContain('No importar');
    expect(html).toContain('Ciberseguridad · Ingeniería');
    expect(html).toContain('Ciberseguridad · Diplomado');
    expect(html).not.toContain('BEGIN:VCALENDAR');
    expect(html).toContain('23/10/2026');
    expect(html).toContain('10:00 a. m.');
  });

  it('weekly: day and 12 h range; exceptions ask the student', () => {
    const html = card(createRows(parsed(weekly({ exceptions: 1 })))[0]!);
    expect(html).toContain('Cada martes, 7:00 a. m. – 9:00 a. m.');
    expect(html).toContain('Importar solo la primera clase');
    expect(html).toContain('Este evento tiene fechas excluidas');
  });

  it('unsupported: says why, cannot be ticked', () => {
    const html = card(
      createRows(
        parsed(proposal({ kindProposal: 'UNSUPPORTED', reason: 'Se repite cada mes.' })),
      )[0]!,
    );
    expect(html).toContain('No se puede importar: Se repite cada mes.');
    expect(html).toMatch(/type="checkbox"[^>]*disabled/);
  });

  it('needs-review text and a server error are text (role=alert), not only color', () => {
    const row = {
      ...createRows(parsed(weekly({ endTime: null })))[0]!,
      error: 'Choca con otra clase.',
    };
    const html = card(row);
    expect(html).toContain('Falta una hora de fin válida.');
    expect(html).toContain('role="alert"');
    expect(html).toContain('Choca con otra clase.');
  });

  it('controls are at least 44 px and nothing forces horizontal overflow', () => {
    const html = card(createRows(parsed(weekly()))[0]!);
    expect(html).toContain('min-h-11');
    expect(html).toContain('min-w-0');
    expect(html).toContain('break-words');
  });
});
