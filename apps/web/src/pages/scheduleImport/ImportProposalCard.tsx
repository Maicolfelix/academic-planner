import {
  SCHEDULE_IMPORT_MESSAGES,
  WEEKDAY_LABELS,
  WEEKDAYS,
  findSubjectByName,
  formatClockRange,
  toLocalParts,
  weekdayOf,
  type Subject,
} from '@planner/core';
import { FormField } from '../../components/FormField';
import { SelectField } from '../../components/SelectField';

import {
  NEW_SUBJECT,
  endsBeforeStart,
  isNewSubject,
  newNameProblem,
  problemsOf,
  type Conflict,
  type ImportDraft,
  type ImportRow,
  type NameConflict,
} from './importDraft';

/** A reading warning stays only while the student has not fixed what it is about. */
const stillApplies = (code: string, d: ImportDraft, hasSuggestion: boolean): boolean => {
  switch (code) {
    case 'SUBJECT_MISSING': // no longer a warning: a NEW subject is the default, shown by the subject state below
      return false;
    case 'SUBJECT_AMBIGUOUS':
      return d.subjectId === '';
    case 'SUBJECT_LIKELY':
      return d.subjectId === '' && !hasSuggestion; // with a suggestion, the "¿Quisiste decir…?" box says it
    case 'MISSING_WEEKDAY':
      return d.weekday === '';
    case 'MISSING_START_TIME':
      return d.startTime === '';
    case 'MISSING_END_TIME':
      return d.endTime === '';
    case 'INVALID_TIME':
      return endsBeforeStart(d);
    default:
      return true;
  }
};

interface Props {
  index: number;
  row: ImportRow;
  subjects: Subject[];
  timeZone: string;
  periodEnd: string;
  onChange: (patch: Partial<ImportDraft>) => void;
  onSelect: (selected: boolean) => void;
  /** Set when this card's NEW subject would merge classes of different codes and nobody has decided yet. */
  nameConflict?: NameConflict;
  onSameSubject?: () => void;
}

const conflictText = (c: Conflict, timeZone: string) => {
  const start = toLocalParts(c.startAt, timeZone);
  return `Conflicto con ${c.title}, ${WEEKDAY_LABELS[weekdayOf(start.date)].toLowerCase()} ${formatClockRange(c.startAt, c.endAt, timeZone)}`;
};

/** One proposed class, editable. Nothing is saved until "Importar seleccionadas". */
export function ImportProposalCard({
  index,
  row,
  subjects,
  timeZone,
  periodEnd,
  onChange,
  onSelect,
  nameConflict,
  onSameSubject,
}: Props) {
  const { proposal: p, draft: d } = row;
  const id = `import-${index}`;
  const locked = row.status === 'created' || row.status === 'creating';
  const problems = problemsOf(d);
  const badRange = endsBeforeStart(d);
  const blocked = problems.length > 0 || badRange || nameConflict !== undefined;
  const conflicts = row.liveConflicts ?? p.conflicts;
  const suggested = p.subjectMatch.suggestedId
    ? subjects.find((s) => s.id === p.subjectMatch.suggestedId)
    : undefined;
  const candidates = p.subjectMatch.candidates;
  const notes = p.warnings.filter((w) => stillApplies(w.code, d, suggested !== undefined));
  const duplicate = p.duplicateOf !== null;

  // The reading itself was unsure (OCR): a NEW subject must not look like a settled one.
  const doubtful = p.warnings.some((w) => w.code === 'LOW_CONFIDENCE');

  // Where this class's subject stands, in words (never color alone): an existing one, a new one, or still undecided.
  const typedMatch = isNewSubject(d) ? findSubjectByName(d.newName, subjects) : undefined;
  const subjectState = nameConflict
    ? { chip: 'Revisar', help: 'Puede ser la misma asignatura que otra clase: decídelo abajo.' }
    : d.subjectId === ''
      ? { chip: 'Revisar', help: 'Elige una asignatura o crea una nueva.' }
      : typedMatch
        ? { chip: 'Existente', help: 'Esa asignatura ya existe: se usará, no se creará otra.' }
        : isNewSubject(d)
          ? doubtful
            ? {
                chip: 'Nueva — revisa el nombre',
                help: 'Se leyó con poca claridad: corrige el nombre si hace falta antes de importar.',
              }
            : {
                chip: 'Nueva — se creará al importar',
                help: SCHEDULE_IMPORT_MESSAGES.SUBJECT_MISSING,
              }
          : { chip: 'Existente', help: '' };

  const badge =
    row.status === 'created'
      ? 'Importada ✓'
      : blocked
        ? 'Necesita revisión'
        : p.status === 'REVIEW'
          ? 'Revisa los datos'
          : 'Lista';

  return (
    <li>
      <article
        aria-labelledby={`${id}-title`}
        className={`flex flex-col gap-3 rounded-lg border-2 bg-white p-4 ${
          row.status === 'created' ? 'border-green-700' : 'border-slate-900'
        }`}
      >
        <header className="flex flex-wrap items-center justify-between gap-2">
          <h3 id={`${id}-title`} className="text-base font-semibold break-words">
            Clase {index + 1}: {d.title || p.title || 'Sin título'}
          </h3>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium">{badge}</span>
        </header>

        <p className="text-sm text-slate-700 break-words">
          Texto leído: <span className="font-medium">“{p.source.rawText}”</span>
          {p.source.page > 1 && <> (página {p.source.page})</>}
        </p>

        {(notes.length > 0 || duplicate || conflicts.length > 0) && (
          <ul
            id={`${id}-warnings`}
            className="flex list-disc flex-col gap-1 rounded-md bg-amber-50 py-2 pr-3 pl-7 text-sm text-amber-950"
          >
            {duplicate && <li>Esta clase parece estar ya en tu agenda.</li>}
            {conflicts.map((c) => (
              <li key={c.startAt + c.title}>{conflictText(c, timeZone)}</li>
            ))}
            {notes
              .filter((w) => w.code !== 'POSSIBLE_DUPLICATE')
              .map((w) => (
                <li key={w.code}>{w.message}</li>
              ))}
          </ul>
        )}

        {row.status === 'error' && row.error && (
          <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">
            {row.error}
          </p>
        )}

        {row.status === 'created' ? (
          <p role="status" className="text-sm text-green-900">
            Clase importada: {d.title}, {WEEKDAY_LABELS[Number(d.weekday) as 1].toLowerCase()}{' '}
            {d.startTime}–{d.endTime}, cada semana.
          </p>
        ) : (
          <>
            {suggested && d.subjectId === '' && (
              <div className="flex flex-col gap-2 rounded-md border border-slate-300 p-3 text-sm">
                <p>¿Quisiste decir {suggested.name}?</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => onChange({ subjectId: suggested.id })}
                    className="min-h-11 rounded-md border border-slate-400 px-4 py-2 font-medium hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
                  >
                    Sí, es {suggested.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => onChange({ subjectId: NEW_SUBJECT })}
                    className="min-h-11 rounded-md border border-slate-400 px-4 py-2 font-medium hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
                  >
                    No, crear una asignatura nueva
                  </button>
                </div>
              </div>
            )}

            {candidates.length > 1 && !suggested && (
              <fieldset className="flex flex-col gap-2 rounded-md border border-slate-300 p-3">
                <legend className="px-1 text-sm font-medium">¿A cuál te refieres?</legend>
                {candidates.map((c) => (
                  <label key={c.id} className="flex min-h-11 items-center gap-2 text-base">
                    <input
                      type="radio"
                      name={`${id}-candidate`}
                      checked={d.subjectId === c.id}
                      onChange={() => onChange({ subjectId: c.id })}
                      className="size-5"
                    />
                    {c.name}
                  </label>
                ))}
                <label className="flex min-h-11 items-center gap-2 text-base">
                  <input
                    type="radio"
                    name={`${id}-candidate`}
                    checked={isNewSubject(d)}
                    onChange={() => onChange({ subjectId: NEW_SUBJECT })}
                    className="size-5"
                  />
                  Ninguna: crear una asignatura nueva
                </label>
              </fieldset>
            )}

            <div className="flex flex-col gap-2">
              <p
                id={`${id}-subject-state`}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
              >
                <span className="rounded-full border border-slate-500 px-2 py-0.5 text-xs font-semibold">
                  {subjectState.chip}
                </span>
                <span className="text-slate-700">{subjectState.help}</span>
              </p>
              <SelectField
                id={`${id}-subject`}
                label="Asignatura"
                placeholder="Elige una asignatura"
                value={d.subjectId}
                onChange={(subjectId) => onChange({ subjectId })}
                options={[
                  ...subjects.map((s) => ({ value: s.id, label: s.name })),
                  { value: NEW_SUBJECT, label: 'Crear una asignatura nueva' },
                ]}
                error={row.errors.subjectId?.[0]}
              />
              {isNewSubject(d) && (
                <FormField
                  id={`${id}-new-name`}
                  label="Nombre de la asignatura nueva"
                  value={d.newName}
                  onChange={(newName) => onChange({ newName })}
                  error={row.errors.newName?.[0] ?? newNameProblem(d)}
                  hint={
                    typedMatch
                      ? `Ya tienes «${typedMatch.name}»: se usará esa asignatura.`
                      : 'Se creará al importar.'
                  }
                />
              )}
            </div>
            <SelectField
              id={`${id}-weekday`}
              label="Día"
              placeholder="Elige el día"
              value={d.weekday}
              onChange={(weekday) => onChange({ weekday })}
              options={WEEKDAYS.map((w) => ({ value: String(w), label: WEEKDAY_LABELS[w] }))}
              error={row.errors.date?.[0]}
            />
            <div className="grid grid-cols-2 gap-3">
              <FormField
                id={`${id}-start`}
                label="Inicio"
                type="time"
                value={d.startTime}
                onChange={(startTime) => onChange({ startTime })}
                error={row.errors.startTime?.[0]}
              />
              <FormField
                id={`${id}-end`}
                label="Fin"
                type="time"
                value={d.endTime}
                onChange={(endTime) => onChange({ endTime })}
                error={
                  row.errors.endTime?.[0] ??
                  (badRange ? 'La hora de fin debe ser posterior a la de inicio.' : undefined)
                }
              />
            </div>
            <FormField
              id={`${id}-title-input`}
              label="Título"
              value={d.title}
              onChange={(title) => onChange({ title })}
              error={row.errors.title?.[0]}
            />
            <FormField
              id={`${id}-until`}
              label="Se repite cada semana hasta"
              type="date"
              value={d.until}
              onChange={(until) => onChange({ until })}
              error={row.errors.recurrence?.[0]}
              hint={`Fin del periodo: ${periodEnd}`}
            />

            {nameConflict && (
              <div className="flex flex-col gap-2 rounded-md border border-amber-500 bg-amber-50 p-3 text-sm text-amber-950">
                <p>
                  Dos clases parecen tener el mismo nombre de asignatura («{d.newName.trim()}»),
                  pero vienen de códigos diferentes ({nameConflict.prefixes.join(' y ')}). Revisa si
                  pertenecen a la misma asignatura.
                </p>
                <div>
                  <button
                    type="button"
                    onClick={onSameSubject}
                    className="min-h-11 rounded-md border border-slate-500 bg-white px-4 py-2 font-medium hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
                  >
                    Sí, es la misma asignatura
                  </button>
                </div>
                <p>Si son distintas, cambia el nombre de una de ellas.</p>
              </div>
            )}

            {(problems.length > 0 || badRange || nameConflict) && (
              <p className="text-sm text-slate-700">
                {problems.length > 0
                  ? `Para importarla falta ${problems.join(', ')}.`
                  : badRange
                    ? 'Corrige la hora de fin para importarla.'
                    : 'Para importarla falta decidir si es la misma asignatura que otra clase.'}
              </p>
            )}

            <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={row.selected && !nameConflict}
                disabled={locked || blocked}
                onChange={(e) => onSelect(e.target.checked)}
                className="size-5"
              />
              Incluir en “Importar seleccionadas”
            </label>
          </>
        )}
      </article>
    </li>
  );
}
