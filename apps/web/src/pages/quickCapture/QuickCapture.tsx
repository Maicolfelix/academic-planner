import {
  QUICK_CAPTURE_MAX_LENGTH,
  QUICK_CAPTURE_MESSAGES,
  createActivitySchema,
  fieldErrorsOf,
  type QuickCaptureResult,
} from '@planner/core';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useCurrentPeriod, useSubjects } from '../../academic/useAcademic';
import { useCreateActivity } from '../../activities/useActivities';
import { ApiRequestError } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { useParseQuickCapture } from '../../quickCapture/useQuickCapture';
import { QuickCapturePreview, type QuickCaptureDraft } from './QuickCapturePreview';

const PARSE_ERROR =
  'No pudimos interpretar el texto. Puedes intentarlo de nuevo o crear la actividad manualmente.';

const toDraft = (c: QuickCaptureResult): QuickCaptureDraft => ({
  title: c.title,
  subjectId: c.subjectId ?? '',
  type: c.type,
  dueDate: c.dueDate ?? '',
  dueTime: c.dueTime ?? '',
});

/**
 * Quick capture: CAPTURE a short phrase -> INTERPRET it (a preview) -> CONFIRM. Enter only interprets; the
 * single way to persist is "Crear actividad", which goes through the same mutation as the manual form, so
 * reminders, Radar, Attention, progress and workload are refreshed exactly as for any other activity.
 */
export function QuickCapture() {
  const { period } = useCurrentPeriod();
  const subjects = useSubjects(period?.id).data ?? [];
  const parse = useParseQuickCapture();
  const create = useCreateActivity();

  const [text, setText] = useState('');
  const [inputError, setInputError] = useState<string>();
  const [capture, setCapture] = useState<QuickCaptureResult>();
  const [draft, setDraft] = useState<QuickCaptureDraft>();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const inputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const focusPreview = useRef(false);
  const focusInput = useRef(false);

  // Focus follows the step: to the preview once it appears, back to the text box when the student leaves it.
  useEffect(() => {
    if (capture && focusPreview.current) {
      focusPreview.current = false;
      previewRef.current?.focus();
    }
    if (!capture && focusInput.current) {
      focusInput.current = false;
      inputRef.current?.focus();
    }
  }, [capture]);

  function interpret(e: FormEvent) {
    e.preventDefault();
    setNotice(undefined);
    setInputError(undefined);
    const trimmed = text.trim();
    if (trimmed === '') return setInputError(QUICK_CAPTURE_MESSAGES.EMPTY);
    if (trimmed.length > QUICK_CAPTURE_MAX_LENGTH)
      return setInputError(QUICK_CAPTURE_MESSAGES.TOO_LONG);

    parse.mutate(text, {
      onSuccess: ({ capture: result }) => {
        if (result.status !== 'OK') return setInputError(result.warnings[0]?.message);
        focusPreview.current = true;
        setErrors({});
        setFormError(undefined);
        setDraft(toDraft(result));
        setCapture(result);
      },
      // The typed text is kept: the student can try again or go to the manual form.
      onError: () => setInputError(PARSE_ERROR),
    });
  }

  function leave(clearText: boolean) {
    focusInput.current = true;
    setCapture(undefined);
    setDraft(undefined);
    setErrors({});
    setFormError(undefined);
    if (clearText) setText('');
  }

  function confirm() {
    if (!draft) return;
    setFormError(undefined);
    // The same schema and the same request as the manual form: quick capture has no creation path of its own.
    const parsed = createActivitySchema.safeParse({
      subjectId: draft.subjectId,
      title: draft.title,
      type: draft.type,
      dueDate: draft.dueDate,
      dueTime: draft.dueTime || undefined,
    });
    if (!parsed.success) return setErrors(fieldErrorsOf(parsed.error));
    setErrors({});
    create.mutate(parsed.data, {
      onSuccess: (activity) => {
        setNotice(`Actividad creada: ${activity.title}.`);
        leave(true);
      },
      onError: (err) => {
        if (err instanceof ApiRequestError && Object.keys(err.fieldErrors).length > 0)
          setErrors(err.fieldErrors);
        else setFormError(err.message);
      },
    });
  }

  return (
    <section aria-labelledby="quick-capture-title" className="flex flex-col gap-2">
      <h2 id="quick-capture-title" className="text-lg font-semibold">
        Captura rápida
      </h2>

      {notice && (
        <p role="status" className="rounded-md bg-green-50 p-3 text-sm text-green-900">
          {notice}{' '}
          <Link to="/activities" className="font-medium underline">
            Ver actividades
          </Link>
        </p>
      )}

      {!capture && (
        <form onSubmit={interpret} noValidate className="flex flex-col gap-2">
          <label htmlFor="quick-capture-text" className="text-sm font-medium text-slate-800">
            Escribe la actividad en una frase
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="quick-capture-text"
              ref={inputRef}
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Ej: parcial redes martes 10am"
              autoComplete="off"
              aria-invalid={inputError ? true : undefined}
              aria-describedby={inputError ? 'quick-capture-error' : undefined}
              className={`min-h-11 w-full min-w-0 rounded-control border bg-surface px-3 py-2 text-base transition-[border-color,box-shadow] duration-(--duration-fast) ease-standard placeholder:text-slate-500 focus:border-accent focus:shadow-lift focus:outline-2 focus:outline-offset-1 focus:outline-accent ${
                inputError ? 'border-red-600' : 'border-slate-400'
              }`}
            />
            <Button type="submit" variant="primary" disabled={parse.isPending} className="shrink-0">
              {parse.isPending ? 'Interpretando…' : 'Interpretar'}
            </Button>
          </div>
          {inputError && (
            <p id="quick-capture-error" role="alert" className="text-sm text-red-700">
              {inputError}{' '}
              {inputError === PARSE_ERROR && (
                <Link to="/activities?action=create" className="font-medium underline">
                  Crear manualmente
                </Link>
              )}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Se interpreta aquí mismo, sin enviar el texto a ningún servicio externo. Nada se guarda
            hasta que confirmes.
          </p>
        </form>
      )}

      {capture && draft && (
        <QuickCapturePreview
          ref={previewRef}
          capture={capture}
          draft={draft}
          subjects={subjects}
          errors={errors}
          formError={formError}
          pending={create.isPending}
          onChange={(patch) => setDraft({ ...draft, ...patch })}
          onConfirm={confirm}
          onEditText={() => leave(false)}
          onCancel={() => leave(true)}
        />
      )}
    </section>
  );
}
