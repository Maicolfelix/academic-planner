import {
  CAPTURE_MAX_LENGTH,
  CAPTURE_MESSAGES,
  type CaptureMode,
  type CaptureConfirmItemError,
} from '@planner/core';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useCurrentPeriod, useSubjects } from '../academic/useAcademic';
import { ApiRequestError } from '../api/client';
import { useMe } from '../auth/useAuth';
import { Button } from '../components/ui/Button';
import { fieldControl } from '../components/ui/fieldStyles';
import { readDraft, useDraftWriter } from '../lib/drafts';
import { CaptureReview } from './CaptureReview';
import {
  captureDraftScope,
  captureDraftSchema,
  fromCaptureDraft,
  toCaptureDraft,
} from './captureDraft';
import {
  buildConfirmRequest,
  createReview,
  reconcileSubjects,
  removeAll,
  setError,
  type ReviewState,
} from './reviewModel';
import { useConfirmCapture, useParseCapture } from './useCapture';

const PARSE_ERROR =
  'No pudimos interpretar el texto. Puedes intentarlo de nuevo o crear la actividad manualmente.';

interface Props {
  mode: CaptureMode;
  /** The label of the text box. */
  label: string;
  placeholder: string;
  rows: number;
  /** Extra line under the box (what it does with the text). */
  help: string;
  submitLabel: string;
  /** Heading level of the review: 2 on a page of its own (the Inbox), 3 inside a section (Quick Capture). */
  level: 2 | 3;
}

/** What the server said was wrong with each card, by its client id. */
function itemErrors(err: ApiRequestError): Record<string, string> {
  const items = (err.details as { items?: CaptureConfirmItemError[] } | undefined)?.items ?? [];
  return Object.fromEntries(items.map((i) => [i.clientId, i.message]));
}

/**
 * Capture, one flow for Quick Capture and the Inbox: WRITE (or paste) once -> the app INTERPRETS everything it can ->
 * REVIEW only what is in doubt -> CONFIRM once. Nothing is created before the confirmation, which creates all that is ticked
 * together or nothing at all. What is written and what is decided is kept (a draft in this browser) until it is created or
 * discarded: leaving the page, closing the tab or reloading does not lose it, and coming back does not interpret it again.
 */
export function CaptureFlow(props: Props) {
  const userId = useMe().data?.id;
  // The draft is private to a user: the flow starts (and reads it) only once we know whose it is, and starts over for another.
  if (!userId) return null;
  return <CaptureFlowFor key={`${userId}:${props.mode}`} userId={userId} {...props} />;
}

function CaptureFlowFor({
  userId,
  mode,
  label,
  placeholder,
  rows,
  help,
  submitLabel,
  level,
}: Props & { userId: string }) {
  const { period } = useCurrentPeriod();
  const fetched = useSubjects(period?.id).data;
  const subjects = useMemo(() => fetched ?? [], [fetched]);
  const parse = useParseCapture();
  const confirm = useConfirmCapture();
  const scope = captureDraftScope(mode);
  const writer = useDraftWriter(userId, scope);
  const max = CAPTURE_MAX_LENGTH[mode];

  // Coming back: take up what was left half done (read once, when the flow opens).
  const [initial] = useState(() => {
    const stored = readDraft(userId, scope, captureDraftSchema);
    return stored ? fromCaptureDraft(stored.payload) : null;
  });
  const [text, setText] = useState(initial?.text ?? '');
  const [rawReview, setReview] = useState<ReviewState | null>(initial?.review ?? null);
  const [restored, setRestored] = useState(initial !== null);
  // A subject the student had chosen may have been deleted meanwhile: it becomes a question again.
  const review = useMemo(
    () => (rawReview && subjects.length > 0 ? reconcileSubjects(rawReview, subjects) : rawReview),
    [rawReview, subjects],
  );
  const [inputError, setInputError] = useState<string>();
  const [confirmError, setConfirmError] = useState<{ message: string; copies: boolean }>();
  const [done, setDone] = useState<string>();

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const focusReview = useRef(false);
  /** Every change of what is written or decided goes through here: it is shown AND kept (nothing is written on load). */
  function commit(nextText: string, nextReview: ReviewState | null) {
    setText(nextText);
    setReview(nextReview);
    writer.save(toCaptureDraft(nextText, nextReview));
  }

  useEffect(() => {
    if (review && focusReview.current) {
      focusReview.current = false;
      document.getElementById('capture-review-title')?.focus(); // the review announces itself
    }
  }, [review]);

  function interpret(e: FormEvent) {
    e.preventDefault();
    setInputError(undefined);
    setDone(undefined);
    setConfirmError(undefined);
    const trimmed = text.trim();
    if (trimmed === '') return setInputError(CAPTURE_MESSAGES.EMPTY);
    if (trimmed.length > max) {
      return setInputError(
        mode === 'QUICK' ? CAPTURE_MESSAGES.TOO_LONG_QUICK : CAPTURE_MESSAGES.TOO_LONG_INBOX,
      );
    }
    parse.mutate(
      { text, mode },
      {
        onSuccess: ({ capture }) => {
          if (capture.status !== 'OK') return setInputError(capture.warnings[0]?.message);
          if (capture.proposals.length === 0 && capture.suggestions.length === 0) {
            return setInputError(CAPTURE_MESSAGES.NO_ACTIVITIES);
          }
          focusReview.current = true;
          setRestored(false);
          commit(text, createReview(capture));
        },
        // The typed text is kept: the student can try again or go to the manual form.
        onError: () => setInputError(PARSE_ERROR),
      },
    );
  }

  function send(allowCopies: boolean) {
    if (!review || confirm.isPending) return;
    setConfirmError(undefined);
    const request = buildConfirmRequest(review);
    if (allowCopies) request.items = request.items.map((i) => ({ ...i, allowDuplicate: true }));
    confirm.mutate(request, {
      onSuccess: (result) => {
        // What was created leaves the review; what the student left unticked stays (and stays kept) to be dealt with.
        const rest = removeAll(review, new Set(result.createdActivities.map((c) => c.clientId)));
        const created =
          result.count === 1 ? '1 actividad creada.' : `${result.count} actividades creadas.`;
        setRestored(false);
        if (rest.items.length === 0) {
          writer.clear();
          setReview(null);
          setText('');
          setDone(created);
          requestAnimationFrame(() => inputRef.current?.focus());
        } else {
          commit(text, rest);
          setDone(
            `${created} Quedan ${rest.items.length} sin crear: complétalas, márcalas o descártalas.`,
          );
        }
      },
      onError: (err) => {
        if (
          err instanceof ApiRequestError &&
          err.status === 409 &&
          err.code === 'DUPLICATE_ACTIVITY'
        ) {
          setReview((r) => (r ? setError(r, itemErrors(err)) : r));
          return setConfirmError({
            message:
              'Ya tienes actividades iguales con la misma fecha y hora. Si las quieres otra vez, créalas de todos modos.',
            copies: true,
          });
        }
        if (err instanceof ApiRequestError && err.details && itemErrors(err)) {
          setReview((r) => (r ? setError(r, itemErrors(err)) : r));
        }
        setConfirmError({ message: err.message, copies: false });
      },
    });
  }

  function backToText() {
    commit(text, null);
    setConfirmError(undefined);
    setRestored(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function discard() {
    writer.clear();
    setReview(null);
    setText('');
    setRestored(false);
    setConfirmError(undefined);
    setInputError(undefined);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  return (
    <div className="flex flex-col gap-3">
      {done && (
        <p role="status" className="rounded-control bg-success-soft p-3 text-sm text-success-ink">
          {done}{' '}
          <Link to="/activities" className="font-medium underline">
            Ver actividades
          </Link>
        </p>
      )}

      {restored && (
        <p role="status" className="text-sm text-muted-foreground">
          Retomé lo que tenías sin terminar.{' '}
          <button type="button" onClick={discard} className="font-medium underline">
            Descartar borrador
          </button>
        </p>
      )}

      {!review && (
        <form onSubmit={interpret} noValidate className="flex flex-col gap-2">
          <label htmlFor={`capture-text-${mode}`} className="text-sm font-medium text-foreground">
            {label}
          </label>
          <textarea
            id={`capture-text-${mode}`}
            ref={inputRef}
            value={text}
            rows={rows}
            onChange={(e) => {
              commit(e.target.value, null);
              setInputError(undefined);
            }}
            placeholder={placeholder}
            onKeyDown={(e) => {
              // Enter is a new line in a box meant for sentences; Ctrl/Cmd+Enter interprets.
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            autoComplete="off"
            aria-invalid={inputError ? true : undefined}
            aria-describedby={`capture-help-${mode}${inputError ? ` capture-error-${mode}` : ''}`}
            className={fieldControl(Boolean(inputError))}
          />
          <p id={`capture-help-${mode}`} className="text-sm text-muted-foreground">
            {mode === 'INBOX' ? `${text.length} / ${max} caracteres. ` : ''}
            {help}
          </p>
          {inputError && (
            <p id={`capture-error-${mode}`} role="alert" className="text-sm text-danger-ink">
              {inputError}{' '}
              {inputError === PARSE_ERROR && (
                <Link to="/activities?action=create" className="font-medium underline">
                  Crear manualmente
                </Link>
              )}
            </p>
          )}
          <div>
            <Button type="submit" variant="primary" disabled={parse.isPending}>
              {parse.isPending ? 'Interpretando…' : submitLabel}
            </Button>
          </div>
        </form>
      )}

      {review && (
        <div className="flex flex-col gap-3">
          <CaptureReview
            level={level}
            state={review}
            onChange={(next) => commit(text, next)}
            subjects={subjects}
            pending={confirm.isPending}
            error={confirmError?.message}
            onConfirm={() => send(false)}
            onConfirmAnyway={confirmError?.copies ? () => send(true) : undefined}
            onBack={backToText}
            onDiscard={discard}
          />
        </div>
      )}
    </div>
  );
}
