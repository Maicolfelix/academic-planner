import {
  EDUCATION_CONTEXTS,
  formatDateOnly,
  studyTrackNameSchema,
  type EducationContext,
  type ProgramEntry,
} from '@planner/core';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Modal } from '../../components/Modal';
import { FormField } from '../../components/FormField';
import { Button } from '../../components/ui/Button';
import { FormActions, FormError } from '../../components/ui/form';
import { LevelStep } from '../../onboarding/LevelStep';
import { PeriodStep } from '../../onboarding/PeriodStep';
import { ProgramStep } from '../../onboarding/ProgramStep';
import { SubjectsStep } from '../../onboarding/SubjectsStep';
import { levelCopy, subjectsTitle } from '../../onboarding/onboardingModel';
import {
  levelLabel,
  studyErrorText,
  subjectsCountLabel,
  typeLabel,
} from '../../studies/studyModel';
import {
  defaultStudyName,
  emptyWizard,
  primaryUseOf,
  stepAfter,
  stepBefore,
  toSetupRequest,
  wizardSteps,
  type WizardState,
  type WizardStep,
} from '../../studies/studyWizardModel';
import { useSetupStudy } from '../../studyTracks/useStudyTracks';

const TYPE_HELP: Record<EducationContext, string> = {
  UNIVERSITY: 'Una carrera o programa universitario, con semestres.',
  SCHOOL: 'El colegio, con materias y grados.',
  OTHER_ACADEMIC: 'Un curso, idiomas, un diplomado o un programa técnico.',
};

/**
 * "Agregar estudio": a short flow in ONE dialog (type, name, period, level, subjects, confirm) that reuses the onboarding's steps
 * for the program, the period, the level and the subjects, but knows nothing of the onboarding (no status, no draft). Nothing is
 * written until the last step; then ONE request creates the study, its first period and its subjects, all or nothing, so a failure
 * leaves nothing behind and everything typed stays here to try again. Dates are never guessed.
 */
export function AddStudyDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const setup = useSetupStudy();
  const [step, setStep] = useState<WizardStep>('TYPE');
  const [data, setData] = useState<WizardState>(emptyWizard);
  const heading = useRef<HTMLHeadingElement>(null);
  const steps = wizardSteps(data.type);
  const patch = (p: Partial<WizardState>) => setData((d) => ({ ...d, ...p }));
  const next = () => {
    const to = stepAfter(step, data.type);
    if (to) setStep(to);
  };
  const back = () => {
    const to = stepBefore(step, data.type);
    if (to) setStep(to);
  };

  // A new step takes the focus (its heading), so a screen reader hears where it is and the keyboard starts there.
  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  const primaryUse = data.type ? primaryUseOf(data.type) : null;
  const title = {
    TYPE: '¿Qué tipo de estudio es?',
    NAME: data.type === 'UNIVERSITY' ? '¿Qué estudias?' : '¿Cómo se llama?',
    PERIOD: '¿Cuál es su periodo actual?',
    LEVEL: levelCopy(primaryUse).title,
    SUBJECTS: subjectsTitle(primaryUse),
    CONFIRM: 'Revisa y crea tu estudio',
  }[step];

  function create() {
    if (setup.isPending) return;
    setup.mutate(toSetupRequest(data), {
      onSuccess: (r) => onDone(`Agregaste «${r.studyTrack.name}».`),
    });
  }

  return (
    <Modal title="Agregar estudio" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-sm text-muted-foreground">
            Paso {steps.indexOf(step) + 1} de {steps.length}
          </p>
          <h3 ref={heading} tabIndex={-1} className="text-lg font-semibold outline-none">
            {title}
          </h3>
        </div>

        {step === 'TYPE' && (
          <TypeStep
            value={data.type}
            onPick={(type) =>
              setData((d) => ({
                ...emptyWizard,
                type,
                // changing the type starts the name over (a school offers its own); the rest of the flow is kept
                name: type === d.type ? d.name : defaultStudyName(type),
                programKey: type === d.type ? d.programKey : null,
                period: d.period,
                subjects: d.subjects,
                level: type === 'OTHER_ACADEMIC' ? emptyWizard.level : d.level,
              }))
            }
            onNext={next}
          />
        )}

        {step === 'NAME' && data.type === 'UNIVERSITY' && (
          <ProgramStep
            primaryUse="UNIVERSITY_STUDENT"
            currentName={data.name || null}
            pending={false}
            required
            onPickCatalog={(entry: ProgramEntry) => {
              patch({ name: entry.name, programKey: entry.key });
              next();
            }}
            onSaveCustom={(name) => {
              patch({ name, programKey: null });
              next();
            }}
            onSkip={next}
          />
        )}
        {step === 'NAME' && data.type !== 'UNIVERSITY' && data.type !== null && (
          <TextNameStep
            type={data.type}
            value={data.name}
            onNext={(name) => {
              patch({ name, programKey: null });
              next();
            }}
          />
        )}

        {step === 'PERIOD' && primaryUse && (
          <PeriodStep
            primaryUse={primaryUse}
            pending={false}
            initial={data.period ?? undefined}
            onSubmit={(period) => {
              patch({ period });
              next();
            }}
          />
        )}

        {step === 'LEVEL' && primaryUse && (
          <LevelStep
            primaryUse={primaryUse}
            current={data.level}
            pending={false}
            onPickNumber={(n) => {
              patch({ level: { studyLevel: n, studyLevelNote: null } });
              next();
            }}
            onSaveNote={(note) => {
              patch({ level: { studyLevel: null, studyLevelNote: note } });
              next();
            }}
            onSkip={next}
          />
        )}

        {step === 'SUBJECTS' && (
          <SubjectsStep
            primaryUse={primaryUse}
            existing={[]}
            chips={data.subjects}
            onChips={(subjects) => patch({ subjects })}
            pending={false}
            onConfirm={(names) => {
              patch({ subjects: names });
              next();
            }}
          />
        )}

        {step === 'CONFIRM' && data.type && data.period && (
          <>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Tipo</dt>
              <dd className="font-medium break-words">{typeLabel(data.type)}</dd>
              <dt className="text-muted-foreground">Nombre</dt>
              <dd className="font-medium break-words">{data.name}</dd>
              <dt className="text-muted-foreground">Periodo</dt>
              <dd className="font-medium break-words">
                {data.period.name} · {formatDateOnly(data.period.startDate)} –{' '}
                {formatDateOnly(data.period.endDate)}
              </dd>
              {levelLabel(data.type, data.level) && (
                <>
                  <dt className="text-muted-foreground">Nivel</dt>
                  <dd className="font-medium break-words">{levelLabel(data.type, data.level)}</dd>
                </>
              )}
              <dt className="text-muted-foreground">Materias</dt>
              <dd className="font-medium break-words">
                {data.subjects.length === 0
                  ? 'Ninguna por ahora'
                  : subjectsCountLabel(data.subjects.length)}
              </dd>
            </dl>
            {data.subjects.length > 0 && (
              <ul aria-label="Materias por crear" className="flex flex-wrap gap-1.5">
                {data.subjects.map((s) => (
                  <li
                    key={s}
                    className="max-w-full rounded-full border border-border bg-secondary px-3 py-1 text-sm break-words"
                  >
                    {s}
                  </li>
                ))}
              </ul>
            )}
            {setup.isError && (
              <FormError>
                {studyErrorText(setup.error)} No se creó nada: lo que escribiste sigue aquí.
              </FormError>
            )}
            <FormActions>
              <Button onClick={back} disabled={setup.isPending}>
                Atrás
              </Button>
              <Button
                variant="primary"
                onClick={create}
                disabled={setup.isPending}
                aria-busy={setup.isPending || undefined}
              >
                {setup.isPending ? 'Creando…' : 'Crear estudio'}
              </Button>
            </FormActions>
          </>
        )}

        {step !== 'TYPE' && step !== 'CONFIRM' && (
          <div>
            <Button variant="ghost" size="sm" onClick={back}>
              Atrás
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

function TypeStep({
  value,
  onPick,
  onNext,
}: {
  value: EducationContext | null;
  onPick: (type: EducationContext) => void;
  onNext: () => void;
}) {
  const [error, setError] = useState<string>();
  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label="Tipo de estudio" className="flex flex-col gap-2">
        {EDUCATION_CONTEXTS.map((type) => {
          const on = value === type;
          return (
            <button
              key={type}
              type="button"
              aria-pressed={on}
              onClick={() => {
                onPick(type);
                setError(undefined);
              }}
              className={`flex min-h-14 flex-col items-start justify-center rounded-control border px-3 py-2 text-left transition-[background-color,transform] duration-(--duration-fast) ease-standard active:scale-[0.99] ${
                on
                  ? 'border-accent bg-accent-soft text-accent-ink'
                  : 'border-border bg-surface hover:bg-secondary'
              }`}
            >
              <span className="font-medium">{typeLabel(type)}</span>
              <span className="text-sm text-muted-foreground">{TYPE_HELP[type]}</span>
            </button>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger-ink">
          {error}
        </p>
      )}
      <div>
        <Button
          variant="primary"
          onClick={() => (value ? onNext() : setError('Elige un tipo de estudio.'))}
        >
          Siguiente
        </Button>
      </div>
    </div>
  );
}

/** A school or "other" study is named freely (a school offers "Colegio"); nothing is searched, nothing is guessed. */
function TextNameStep({
  type,
  value,
  onNext,
}: {
  type: EducationContext;
  value: string;
  onNext: (name: string) => void;
}) {
  const [name, setName] = useState(value);
  const [error, setError] = useState<string>();
  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = studyTrackNameSchema.safeParse(name);
    if (!parsed.success) return setError(parsed.error.issues[0]!.message);
    onNext(parsed.data);
  }
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      <FormField
        id="study-name"
        label="Nombre del estudio"
        value={name}
        onChange={(v) => {
          setName(v);
          setError(undefined);
        }}
        maxLength={80}
        autoComplete="off"
        placeholder={
          type === 'SCHOOL' ? 'Colegio, Liceo…' : 'Curso de inglés, técnico en…, diplomado en…'
        }
        error={error}
      />
      <div>
        <Button type="submit" variant="primary">
          Siguiente
        </Button>
      </div>
    </form>
  );
}
