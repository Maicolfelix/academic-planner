import {
  DEFAULT_TIMEZONE,
  SCHEDULE_IMPORT_MAX_BYTES,
  SCHEDULE_IMPORT_MESSAGES,
  createScheduleBlockSchema,
  fieldErrorsOf,
  firstWeekdayOnOrAfter,
  formatDateOnly,
  type ScheduleImportResult,
  type Weekday,
} from '@planner/core';
import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useCurrentPeriod, useSubjects } from '../academic/useAcademic';
import { ApiRequestError } from '../api/client';
import { saveScheduleBlock } from '../api/schedule';
import { useMe } from '../auth/useAuth';
import { OFFLINE_MESSAGE } from '../pwa/pwaState';
import { useSaveScheduleBlock } from '../schedule/useSchedule';
import { useParseScheduleImport } from '../scheduleImport/useScheduleImport';
import {
  ImportProposalCard,
  endsBeforeStart,
  problemsOf,
  type ImportDraft,
  type ImportRow,
} from './scheduleImport/ImportProposalCard';

const ACCEPT = 'image/png,image/jpeg,application/pdf,image/*';
const READ_ERROR =
  'No pudimos leer suficiente información del horario. Prueba con otra imagen o ingresa tu horario manualmente.';
const TYPE_OK = /\.(png|jpe?g|pdf)$/i;

const button =
  'min-h-11 rounded-md border border-slate-400 px-4 py-2 text-sm hover:bg-slate-100 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900';
const primary =
  'min-h-11 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900';

const toRows = (result: ScheduleImportResult): ImportRow[] =>
  result.proposals.map((proposal) => {
    const draft: ImportDraft = {
      subjectId: proposal.subjectId ?? '',
      weekday: proposal.weekday === null ? '' : String(proposal.weekday),
      startTime: proposal.startTime ?? '',
      endTime: proposal.endTime ?? '',
      title: proposal.title,
      until: proposal.recurrence.until,
    };
    return {
      proposal,
      draft,
      // Reviewed-first: only clean, new classes start selected; a duplicate or a doubtful one is the student's call.
      selected:
        proposal.status === 'READY' &&
        proposal.duplicateOf === null &&
        problemsOf(draft).length === 0 &&
        !endsBeforeStart(draft),
      autoTitle: true, // the title follows the subject until the student types their own
      status: 'idle',
      errors: {},
      liveConflicts: null,
    };
  });

/**
 * Schedule import: FILE -> READ (text or OCR) -> PROPOSALS -> REVIEW/CORRECT -> CONFIRM. Reading never saves; each
 * confirmed class is created, one after another, through the same Schedule API as the manual form (so conflicts,
 * the period's limits and every cache refresh work exactly the same). What was created stays created.
 */
export function ScheduleImportPage() {
  const { period } = useCurrentPeriod();
  const subjects = useSubjects(period?.id).data ?? [];
  const timeZone = useMe().data?.timezone ?? DEFAULT_TIMEZONE;
  const parse = useParseScheduleImport();
  const save = useSaveScheduleBlock();

  const [file, setFile] = useState<File>();
  const [dragging, setDragging] = useState(false);
  const [inputError, setInputError] = useState<string>();
  const [result, setResult] = useState<ScheduleImportResult>();
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [creating, setCreating] = useState(false);
  const [summary, setSummary] = useState<string>();

  const abort = useRef<AbortController | null>(null);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const resultsRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const focusResults = useRef(false);
  const importing = useRef(false);

  useEffect(() => {
    if (result && focusResults.current) {
      focusResults.current = false;
      resultsRef.current?.focus();
    }
  }, [result]);
  useEffect(() => {
    if (inputError) errorRef.current?.focus();
  }, [inputError]);
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const t of pending.values()) clearTimeout(t);
      abort.current?.abort();
    };
  }, []);

  function choose(next: File | undefined) {
    setInputError(undefined);
    if (!next) return setFile(undefined);
    if (next.size > SCHEDULE_IMPORT_MAX_BYTES) {
      setFile(undefined);
      return setInputError(SCHEDULE_IMPORT_MESSAGES.TOO_LARGE);
    }
    if (!TYPE_OK.test(next.name) && !/^(image\/(png|jpe?g)|application\/pdf)$/.test(next.type)) {
      setFile(undefined);
      return setInputError(SCHEDULE_IMPORT_MESSAGES.UNSUPPORTED);
    }
    setFile(next);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    choose(e.dataTransfer.files[0]);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setInputError(undefined);
    setSummary(undefined);
    if (!file) return setInputError('Selecciona un archivo de imagen o PDF.');
    const controller = new AbortController();
    abort.current = controller;
    parse.mutate(
      { file, signal: controller.signal },
      {
        onSuccess: (res) => {
          focusResults.current = true;
          setRows(toRows(res));
          setResult(res);
        },
        onError: (err) => {
          if (err instanceof ApiRequestError && err.code === 'ABORTED') return;
          if (err instanceof ApiRequestError && err.status === 0) {
            return setInputError(`${OFFLINE_MESSAGE} Procesar el horario necesita conexión.`);
          }
          setInputError(
            err instanceof ApiRequestError && err.status !== 500 ? err.message : READ_ERROR,
          );
        },
      },
    );
  }

  const patchRow = (i: number, change: Partial<ImportRow>) =>
    setRows((all) => all.map((r, j) => (j === i ? { ...r, ...change } : r)));

  /** Edits a field; the conflicts are re-checked (Schedule service, dry run) once the student pauses. */
  function edit(i: number, change: Partial<ImportDraft>) {
    const row = rows[i]!;
    const draft = { ...row.draft, ...change };
    const subjectName = subjects.find((s) => s.id === draft.subjectId)?.name;
    // A class takes the name of its subject until the student types their own title.
    const autoTitle = 'title' in change ? false : row.autoTitle;
    if ('subjectId' in change && autoTitle && subjectName) draft.title = subjectName;
    const blocked = problemsOf(draft).length > 0 || endsBeforeStart(draft);
    patchRow(i, { draft, autoTitle, errors: {}, selected: blocked ? false : row.selected });

    clearTimeout(timers.current.get(i));
    if (blocked || !result || !period) return;
    timers.current.set(
      i,
      setTimeout(() => {
        const input = toInput(draft, result.period.startDate);
        const parsed = createScheduleBlockSchema.safeParse(input);
        if (!parsed.success) return;
        saveScheduleBlock(undefined, parsed.data, true).then(
          ({ warnings }) => {
            const own = row.proposal.duplicateOf?.id;
            patchRow(i, {
              liveConflicts: warnings
                .filter((w) => w.with.blockId !== own)
                .map((w) => ({
                  title: w.with.title,
                  startAt: w.with.startAt,
                  endAt: w.with.endAt,
                })),
            });
          },
          () => undefined, // a rule the form will explain when importing
        );
      }, 400),
    );
  }

  const importable = rows.filter(
    (r) =>
      r.status !== 'created' &&
      r.status !== 'creating' &&
      problemsOf(r.draft).length === 0 &&
      !endsBeforeStart(r.draft),
  );
  const toImport = rows
    .map((row, i) => ({ row, i }))
    .filter(({ row }) => row.selected && row.status !== 'created');
  const importedCount = rows.filter((r) => r.status === 'created').length;

  function setAll(selected: boolean) {
    setRows((all) => all.map((r) => (importable.includes(r) ? { ...r, selected } : r)));
  }

  async function confirm() {
    if (importing.current || !result) return; // a double click must not import twice
    importing.current = true;
    setCreating(true);
    setSummary(undefined);
    let ok = 0;
    let failed = 0;
    for (const { row, i } of toImport) {
      const parsed = createScheduleBlockSchema.safeParse(
        toInput(row.draft, result.period.startDate),
      );
      if (!parsed.success) {
        failed++;
        patchRow(i, {
          status: 'error',
          error: 'Revisa los campos marcados.',
          errors: fieldErrorsOf(parsed.error),
        });
        continue;
      }
      patchRow(i, { status: 'creating', error: undefined, errors: {} });
      try {
        await save.mutateAsync({ input: parsed.data });
        ok++;
        patchRow(i, { status: 'created', selected: false });
      } catch (err) {
        failed++;
        patchRow(i, {
          status: 'error',
          error: err instanceof Error ? err.message : 'No se pudo importar la clase.',
          errors: err instanceof ApiRequestError ? err.fieldErrors : {},
        });
      }
    }
    setSummary(
      `${ok} ${ok === 1 ? 'clase importada' : 'clases importadas'}, ${failed} ${failed === 1 ? 'necesita corrección' : 'necesitan corrección'}.`,
    );
    importing.current = false;
    setCreating(false);
  }

  function reset() {
    setResult(undefined);
    setRows([]);
    setFile(undefined);
    setSummary(undefined);
    setInputError(undefined);
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">Importar horario</h1>
        <Link to="/calendar" className={`${button} inline-flex items-center`}>
          Volver a la Agenda
        </Link>
      </header>

      {!result && (
        <form onSubmit={submit} noValidate className="flex flex-col gap-3">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`flex flex-col gap-2 rounded-lg border-2 border-dashed p-4 ${
              dragging ? 'border-slate-900 bg-slate-100' : 'border-slate-400'
            }`}
          >
            <label htmlFor="schedule-file" className="text-sm font-medium text-slate-800">
              Archivo del horario (imagen PNG o JPG, o PDF)
            </label>
            <p className="text-sm text-slate-600">
              Arrastra tu horario aquí o selecciona un archivo.
            </p>
            <input
              id="schedule-file"
              type="file"
              accept={ACCEPT}
              onChange={(e) => choose(e.target.files?.[0])}
              aria-invalid={inputError ? true : undefined}
              aria-describedby={`schedule-file-help${inputError ? ' schedule-file-error' : ''}`}
              className="min-h-11 w-full min-w-0 text-base"
            />
            {file && (
              <p className="text-sm text-slate-800 break-words">
                Archivo elegido: <span className="font-medium">{file.name}</span>
              </p>
            )}
          </div>
          <p id="schedule-file-help" className="text-sm text-slate-600">
            Máximo 10 MB; los PDF, hasta 5 páginas. El archivo se lee en el servidor de Academic
            Planner, no se envía a terceros y no se guarda: solo se crean las clases que confirmes.
          </p>
          {inputError && (
            <p
              id="schedule-file-error"
              ref={errorRef}
              tabIndex={-1}
              role="alert"
              className="text-sm text-red-700 outline-none"
            >
              {inputError}{' '}
              <Link to="/calendar" className="font-medium underline">
                Ingresar horario manualmente
              </Link>
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={parse.isPending} className={primary}>
              {parse.isPending ? 'Procesando horario…' : 'Procesar horario'}
            </button>
            {parse.isPending && (
              <button type="button" onClick={() => abort.current?.abort()} className={button}>
                Cancelar
              </button>
            )}
          </div>
          {parse.isPending && (
            <p role="status" className="text-sm text-slate-700">
              Procesando horario… Puede tardar unos segundos.
            </p>
          )}
        </form>
      )}

      {result && (
        <div
          ref={resultsRef}
          tabIndex={-1}
          role="region"
          aria-labelledby="import-results-title"
          className="flex flex-col gap-4 outline-none"
        >
          <h2 id="import-results-title" className="text-lg font-semibold">
            {rows.length === 0
              ? 'Sin clases detectadas'
              : `${rows.length} ${rows.length === 1 ? 'clase detectada' : 'clases detectadas'}`}
          </h2>
          <p className="text-sm text-slate-600">
            {result.source.type === 'PDF'
              ? result.source.method === 'PDF_TEXT'
                ? 'Leído del texto del PDF.'
                : 'Leído de un PDF escaneado con reconocimiento de texto (OCR).'
              : 'Leído de la imagen con reconocimiento de texto (OCR).'}{' '}
            Revisa y corrige los datos: nada se crea hasta que pulses “Importar seleccionadas”.
            Periodo: {formatDateOnly(result.period.startDate)} –{' '}
            {formatDateOnly(result.period.endDate)}.
          </p>

          {result.warnings.length > 0 && (
            <ul className="flex list-disc flex-col gap-1 rounded-md bg-amber-50 py-2 pr-3 pl-7 text-sm text-amber-950">
              {result.warnings.map((w) => (
                <li key={w.code}>{w.message}</li>
              ))}
            </ul>
          )}

          {rows.length === 0 && (
            <p className="text-sm">
              <Link to="/calendar" className="font-medium underline">
                Ingresar horario manualmente
              </Link>
            </p>
          )}

          {summary && (
            <p role="status" className="rounded-md bg-green-50 p-3 text-sm text-green-900">
              {summary}{' '}
              {importedCount > 0 && (
                <Link to="/calendar" className="font-medium underline">
                  Ver Agenda
                </Link>
              )}
            </p>
          )}

          {rows.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setAll(true)}
                disabled={creating}
                className={button}
              >
                Seleccionar todas
              </button>
              <button
                type="button"
                onClick={() => setAll(false)}
                disabled={creating}
                className={button}
              >
                Deseleccionar todas
              </button>
            </div>
          )}

          <ul className="flex flex-col gap-4">
            {rows.map((row, i) => (
              <ImportProposalCard
                key={row.proposal.index}
                index={i}
                row={row}
                subjects={subjects}
                timeZone={timeZone}
                periodEnd={formatDateOnly(result.period.endDate)}
                onChange={(change) => edit(i, change)}
                onSelect={(selected) => patchRow(i, { selected })}
              />
            ))}
          </ul>

          <div className="flex flex-wrap items-center gap-2">
            {rows.length > 0 && (
              <button
                type="button"
                onClick={() => void confirm()}
                disabled={creating || toImport.length === 0}
                className={primary}
              >
                {creating ? 'Importando…' : 'Importar seleccionadas'}
              </button>
            )}
            <button type="button" onClick={reset} disabled={creating} className={button}>
              {rows.length === 0 ? 'Probar otra imagen' : 'Subir otro archivo'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The same body the manual form sends: the first date of a series comes from its weekday, as a calendar day. */
function toInput(d: ImportDraft, periodStart: string) {
  return {
    type: 'CLASS' as const,
    subjectId: d.subjectId,
    title: d.title,
    date: firstWeekdayOnOrAfter(periodStart, Number(d.weekday) as Weekday),
    startTime: d.startTime,
    endTime: d.endTime,
    recurrence: { frequency: 'WEEKLY' as const, until: d.until },
  };
}
