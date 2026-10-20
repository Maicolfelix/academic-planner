import {
  ICS_IMPORT_MAX_BYTES,
  ICS_IMPORT_MESSAGES,
  icsItemErrorSchema,
  type IcsParseResponse,
} from '@planner/core';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { ApiRequestError } from '../api/client';
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
  type ReviewRow,
} from '../icsImport/icsReviewModel';
import { useConfirmIcsImport, useParseIcs } from '../icsImport/useIcsImport';
import { OFFLINE_MESSAGE } from '../pwa/pwaState';
import { IcsRowCard } from './icsImport/IcsRowCard';

const READ_ERROR =
  'No pudimos leer el calendario. Revisa que sea un archivo .ics e inténtalo de nuevo.';
const button =
  'min-h-11 rounded-md border border-slate-400 px-4 py-2 text-sm hover:bg-slate-100 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900';
const primary =
  'min-h-11 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900';

/**
 * .ics import: FILE -> READ -> PROPOSALS -> REVIEW/CORRECT -> CONFIRM. Reading never saves and the file is not stored. Confirming
 * is ONE request, all or nothing. The raw file is never shown: only the events it was understood to hold.
 */
export function IcsImportPage() {
  const parse = useParseIcs();
  const confirmImport = useConfirmIcsImport();
  const [file, setFile] = useState<File>();
  const [inputError, setInputError] = useState<string>();
  const [result, setResult] = useState<IcsParseResponse>();
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [summary, setSummary] = useState<string>();
  const [submitError, setSubmitError] = useState<string>();
  const [creating, setCreating] = useState(false);
  const importing = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const submitErrorRef = useRef<HTMLParagraphElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const focusResults = useRef(false);

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
    if (submitError) submitErrorRef.current?.focus();
  }, [submitError]);
  useEffect(() => () => abort.current?.abort(), []);

  function choose(next: File | undefined) {
    setInputError(undefined);
    if (!next) return setFile(undefined);
    if (next.size > ICS_IMPORT_MAX_BYTES) {
      setFile(undefined);
      return setInputError(ICS_IMPORT_MESSAGES.TOO_LARGE);
    }
    setFile(next);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setInputError(undefined);
    setSummary(undefined);
    if (!file) return setInputError('Selecciona un archivo .ics.');
    const controller = new AbortController();
    abort.current = controller;
    parse.mutate(
      { file, signal: controller.signal },
      {
        onSuccess: (res) => {
          focusResults.current = true;
          setRows(createRows(res));
          setResult(res);
        },
        onError: (err) => {
          if (err instanceof ApiRequestError && err.code === 'ABORTED') return;
          if (err instanceof ApiRequestError && err.status === 0)
            return setInputError(`${OFFLINE_MESSAGE} Leer el calendario necesita conexión.`);
          setInputError(
            err instanceof ApiRequestError && err.status !== 500 ? err.message : READ_ERROR,
          );
        },
      },
    );
  }

  const patch = (id: string, change: Partial<ReviewRow>) =>
    setRows((all) => patchRow(all, id, change));
  const stats = summarize(rows);

  async function confirm() {
    if (importing.current || !result) return; // a double click must not import twice
    const request = buildConfirmRequest(rows);
    if (!request) return; // something ticked is still unresolved: all or nothing
    importing.current = true;
    setCreating(true);
    setSummary(undefined);
    setSubmitError(undefined);
    try {
      const out = await confirmImport.mutateAsync(request);
      const done = new Set(
        [...out.createdActivities, ...out.createdBlocks, ...out.reusedBlocks].map(
          (c) => c.clientId,
        ),
      );
      setRows((all) => removeRows(setErrors(all, {}), done));
      setSummary(
        createdMessage({
          activities: out.createdActivities.length,
          blocks: out.createdBlocks.length,
          reused: out.reusedBlocks.length,
        }),
      );
    } catch (err) {
      // All or nothing: nothing was saved. The refused items (if the server says which) show why.
      const items = icsItemErrorSchema
        .array()
        .safeParse(
          err instanceof ApiRequestError
            ? (err.details as { items?: unknown } | undefined)?.items
            : undefined,
        );
      if (items.success)
        setRows((all) =>
          setErrors(all, Object.fromEntries(items.data.map((i) => [i.clientId, i.message]))),
        );
      setSubmitError(
        err instanceof ApiRequestError && err.status === 0
          ? `${OFFLINE_MESSAGE} Importar necesita conexión. No se importó nada.`
          : err instanceof ApiRequestError && err.status < 500
            ? err.message
            : 'No se pudo importar. No se guardó nada: inténtalo de nuevo.',
      );
    } finally {
      importing.current = false;
      setCreating(false);
    }
  }

  function reset() {
    setResult(undefined);
    setRows([]);
    setFile(undefined);
    setSummary(undefined);
    setSubmitError(undefined);
    setInputError(undefined);
  }

  const subjects = result?.subjects ?? [];

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">Importar calendario</h1>
        <Link to="/calendar" className={`${button} inline-flex items-center`}>
          Volver a la Agenda
        </Link>
      </header>

      {!result && (
        <form onSubmit={submit} noValidate className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 rounded-lg border-2 border-dashed border-slate-400 p-4">
            <label htmlFor="ics-file" className="text-sm font-medium text-slate-800">
              Archivo de calendario (.ics)
            </label>
            <input
              id="ics-file"
              type="file"
              accept=".ics,text/calendar"
              onChange={(e) => choose(e.target.files?.[0])}
              aria-invalid={inputError ? true : undefined}
              aria-describedby={`ics-file-help${inputError ? ' ics-file-error' : ''}`}
              className="min-h-11 w-full min-w-0 text-base"
            />
            {file && (
              <p className="text-sm break-words text-slate-800">
                Archivo elegido: <span className="font-medium">{file.name}</span>
              </p>
            )}
          </div>
          <p id="ics-file-help" className="text-sm text-slate-600">
            Máximo 1 MB y 500 eventos. Se entienden eventos únicos y clases que se repiten cada
            semana. El archivo se lee en el servidor de Academic Planner, no se guarda: solo se crea
            lo que confirmes.
          </p>
          {inputError && (
            <p
              id="ics-file-error"
              ref={errorRef}
              tabIndex={-1}
              role="alert"
              className="text-sm text-red-700 outline-none"
            >
              {inputError}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={parse.isPending} className={primary}>
              {parse.isPending ? 'Leyendo calendario…' : 'Leer calendario'}
            </button>
            {parse.isPending && (
              <button type="button" onClick={() => abort.current?.abort()} className={button}>
                Cancelar
              </button>
            )}
          </div>
          {parse.isPending && (
            <p role="status" className="text-sm text-slate-700">
              Leyendo calendario…
            </p>
          )}
        </form>
      )}

      {result && (
        <div
          ref={resultsRef}
          tabIndex={-1}
          role="region"
          aria-labelledby="ics-results-title"
          className="flex flex-col gap-4 outline-none"
        >
          <h2 id="ics-results-title" className="text-lg font-semibold">
            {result.proposals.length === 0
              ? 'Sin eventos en el archivo'
              : `${result.proposals.length} ${result.proposals.length === 1 ? 'evento' : 'eventos'} en ${result.fileName}`}
          </h2>
          <p className="text-sm text-slate-600">
            Revisa y corrige: nada se crea hasta que pulses el botón de importar.
          </p>

          {submitError && (
            <p
              ref={submitErrorRef}
              tabIndex={-1}
              role="alert"
              className="rounded-md bg-red-50 p-3 text-sm text-red-800 outline-none"
            >
              {submitError}
            </p>
          )}
          {summary && (
            <p role="status" className="rounded-md bg-green-50 p-3 text-sm text-green-900">
              {summary}{' '}
              <Link to="/calendar" className="font-medium underline">
                Ver Agenda
              </Link>
            </p>
          )}

          <ul className="flex flex-col gap-4">
            {rows.map((row) => (
              <IcsRowCard
                key={row.proposal.clientId}
                row={row}
                subjects={subjectOptions(row, subjects)}
                disabled={creating}
                onPatch={(change) => patch(row.proposal.clientId, change)}
                onKind={(kind) => setRows((all) => setKind(all, row.proposal.clientId, kind))}
                onRemove={() => setRows((all) => removeRows(all, new Set([row.proposal.clientId])))}
              />
            ))}
          </ul>

          <div className="flex flex-wrap items-center gap-2">
            {rows.length > 0 && (
              <button
                type="button"
                onClick={() => void confirm()}
                disabled={creating || !canConfirm(rows)}
                className={primary}
              >
                {confirmLabel(stats, creating)}
              </button>
            )}
            <button type="button" onClick={reset} disabled={creating} className={button}>
              Subir otro archivo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
