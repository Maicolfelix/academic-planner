import {
  ACADEMIC_INBOX_MAX_LENGTH,
  ACADEMIC_INBOX_MESSAGES,
  createActivitySchema,
  fieldErrorsOf,
  type AcademicInboxResult,
} from '@planner/core';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useCurrentPeriod, useSubjects } from '../academic/useAcademic';
import { useCreateActivity } from '../activities/useActivities';
import { ApiRequestError } from '../api/client';
import { useParseAcademicInbox } from '../academicInbox/useAcademicInbox';
import {
  ProposalCard,
  missingOf,
  type ProposalCardState,
  type ProposalDraft,
} from './inbox/ProposalCard';

const PARSE_ERROR =
  'No pudimos interpretar el mensaje. Puedes intentarlo de nuevo o crear la actividad manualmente.';

const toCards = (inbox: AcademicInboxResult): ProposalCardState[] =>
  inbox.proposals.map((proposal) => {
    const draft: ProposalDraft = {
      title: proposal.title,
      subjectId: proposal.subjectId ?? '',
      type: proposal.type,
      dueDate: proposal.dueDate ?? '',
      dueTime: proposal.dueTime ?? '',
    };
    return {
      proposal,
      draft,
      // Duplicates and incomplete proposals start unselected: the student opts in explicitly.
      selected: missingOf(draft).length === 0 && proposal.duplicateOf === null,
      discarded: false,
      status: 'idle',
      errors: {},
    };
  });

/**
 * Academic inbox: PASTE a message -> INTERPRET it -> REVIEW the proposals -> CONFIRM. Interpreting never saves;
 * confirming creates each selected proposal, one after another, through the same mutation as the manual form
 * (no batch endpoint, no all-or-nothing transaction: what was created stays created).
 */
export function InboxPage() {
  const { period } = useCurrentPeriod();
  const subjects = useSubjects(period?.id).data ?? [];
  const parse = useParseAcademicInbox();
  const create = useCreateActivity();

  const [text, setText] = useState('');
  const [inputError, setInputError] = useState<string>();
  const [inbox, setInbox] = useState<AcademicInboxResult>();
  const [cards, setCards] = useState<ProposalCardState[]>([]);
  const [creating, setCreating] = useState(false);
  const [summary, setSummary] = useState<string>();

  const resultsRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const focusResults = useRef(false);

  useEffect(() => {
    if (inbox && focusResults.current) {
      focusResults.current = false;
      resultsRef.current?.focus();
    }
  }, [inbox]);
  useEffect(() => {
    if (inputError) errorRef.current?.focus();
  }, [inputError]);

  function interpret(e: FormEvent) {
    e.preventDefault();
    setInputError(undefined);
    setSummary(undefined);
    const trimmed = text.trim();
    if (trimmed === '') return setInputError(ACADEMIC_INBOX_MESSAGES.EMPTY);
    if (trimmed.length > ACADEMIC_INBOX_MAX_LENGTH)
      return setInputError(ACADEMIC_INBOX_MESSAGES.TOO_LONG);

    parse.mutate(text, {
      onSuccess: ({ inbox: result }) => {
        if (result.status !== 'OK') return setInputError(result.warnings[0]?.message);
        focusResults.current = true;
        setCards(toCards(result));
        setInbox(result);
      },
      // The pasted text is kept so the student can retry or go to the manual form.
      onError: () => setInputError(PARSE_ERROR),
    });
  }

  const patch = (i: number, change: Partial<ProposalCardState>) =>
    setCards((all) => all.map((c, j) => (j === i ? { ...c, ...change } : c)));

  const visible = cards.map((card, i) => ({ card, i })).filter(({ card }) => !card.discarded);
  const toCreate = visible.filter(({ card }) => card.selected && card.status !== 'created');
  const created = cards.filter((c) => c.status === 'created').length;

  async function confirm() {
    setCreating(true);
    setSummary(undefined);
    let ok = 0;
    for (const { card, i } of toCreate) {
      const d = card.draft;
      const parsed = createActivitySchema.safeParse({
        subjectId: d.subjectId,
        title: d.title,
        type: d.type,
        dueDate: d.dueDate,
        dueTime: d.dueTime || undefined,
      });
      if (!parsed.success) {
        patch(i, {
          status: 'error',
          error: `Falta completar: ${missingOf(d).join(', ') || 'revisa los campos'}.`,
          errors: fieldErrorsOf(parsed.error),
        });
        continue;
      }
      patch(i, { status: 'creating', error: undefined, errors: {} });
      try {
        await create.mutateAsync(parsed.data);
        patch(i, { status: 'created', selected: false });
        ok++;
      } catch (err) {
        patch(i, {
          status: 'error',
          error: err instanceof Error ? err.message : 'No se pudo crear la actividad.',
          errors: err instanceof ApiRequestError ? err.fieldErrors : {},
        });
      }
    }
    const pending = toCreate.length - ok;
    setSummary(
      `${ok} ${ok === 1 ? 'creada' : 'creadas'}, ${pending} ${pending === 1 ? 'pendiente' : 'pendientes'}.`,
    );
    setCreating(false);
  }

  function reset() {
    setInbox(undefined);
    setCards([]);
    setSummary(undefined);
    setText('');
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Bandeja académica</h1>

      {!inbox && (
        <form onSubmit={interpret} noValidate className="flex flex-col gap-2">
          <label htmlFor="inbox-text" className="text-sm font-medium text-slate-800">
            Mensaje del profesor o instrucción académica
          </label>
          <textarea
            id="inbox-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            placeholder="Pega aquí un mensaje de tu profesor o una instrucción académica…"
            aria-invalid={inputError ? true : undefined}
            aria-describedby={`inbox-help${inputError ? ' inbox-error' : ''}`}
            className={`w-full min-w-0 rounded-md border bg-white px-3 py-2 text-base focus:outline-2 focus:outline-offset-1 focus:outline-slate-900 ${
              inputError ? 'border-red-600' : 'border-slate-400'
            }`}
          />
          <p id="inbox-help" className="text-sm text-slate-600">
            {text.length} / {ACADEMIC_INBOX_MAX_LENGTH} caracteres. Se interpreta aquí mismo, sin
            enviar el texto a ningún servicio externo y sin guardarlo. Nada se crea hasta que
            confirmes.
          </p>
          {inputError && (
            <p
              id="inbox-error"
              ref={errorRef}
              tabIndex={-1}
              role="alert"
              className="text-sm text-red-700 outline-none"
            >
              {inputError}{' '}
              {inputError === PARSE_ERROR && (
                <Link to="/activities?action=create" className="font-medium underline">
                  Crear manualmente
                </Link>
              )}
            </p>
          )}
          <div>
            <button
              type="submit"
              disabled={parse.isPending}
              className="min-h-11 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
            >
              {parse.isPending ? 'Interpretando…' : 'Interpretar mensaje'}
            </button>
          </div>
        </form>
      )}

      {inbox && (
        <div
          ref={resultsRef}
          tabIndex={-1}
          aria-labelledby="inbox-results-title"
          role="region"
          className="flex flex-col gap-4 outline-none"
        >
          <h2 id="inbox-results-title" className="text-lg font-semibold">
            {inbox.proposals.length === 0
              ? 'Sin actividades'
              : `${inbox.proposals.length} ${inbox.proposals.length === 1 ? 'propuesta' : 'propuestas'}`}
          </h2>

          {inbox.warnings.length > 0 && (
            <ul className="flex list-disc flex-col gap-1 rounded-md bg-amber-50 py-2 pr-3 pl-7 text-sm text-amber-950">
              {inbox.warnings.map((w) => (
                <li key={w.code}>{w.message}</li>
              ))}
            </ul>
          )}

          {inbox.proposals.length === 0 && (
            <div className="flex flex-col gap-2 text-sm">
              <p>{ACADEMIC_INBOX_MESSAGES.NO_ACTIVITIES}</p>
              <p>
                <Link to="/activities?action=create" className="font-medium underline">
                  Crear actividad manualmente
                </Link>{' '}
                ·{' '}
                <Link to="/dashboard" className="font-medium underline">
                  Usar Captura rápida
                </Link>
              </p>
            </div>
          )}

          {summary && (
            <p role="status" className="rounded-md bg-green-50 p-3 text-sm text-green-900">
              {summary}{' '}
              {created > 0 && (
                <Link to="/activities" className="font-medium underline">
                  Ver actividades
                </Link>
              )}
            </p>
          )}

          <ul className="flex flex-col gap-4">
            {visible.map(({ card, i }) => (
              <ProposalCard
                key={card.proposal.index}
                index={i}
                card={card}
                subjects={subjects}
                onChange={(change) => patch(i, { draft: { ...card.draft, ...change } })}
                onSelect={(selected) => patch(i, { selected })}
                onDiscard={() => patch(i, { discarded: true, selected: false })}
              />
            ))}
          </ul>

          <div className="flex flex-wrap items-center gap-2">
            {visible.length > 0 && (
              <button
                type="button"
                onClick={confirm}
                disabled={creating || toCreate.length === 0}
                className="min-h-11 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
              >
                {creating ? 'Creando…' : 'Crear seleccionadas'}
              </button>
            )}
            <button
              type="button"
              onClick={reset}
              disabled={creating}
              className="min-h-11 rounded-md border border-slate-400 px-4 py-2 text-sm hover:bg-slate-100 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
            >
              {created > 0 ? 'Interpretar otro mensaje' : 'Volver al mensaje'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
