import type { PrimaryUse, ProgramEntry } from '@planner/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate } from 'react-router';
import {
  useCreatePeriod,
  useCreateSubjectsBatch,
  useHomePeriod,
  useSubjects,
  useUpdatePeriod,
} from '../academic/useAcademic';
import { ApiRequestError } from '../api/client';
import { FullPageMessage, isUnreachable, RetryMessage } from '../auth/guards';
import { useMe } from '../auth/useAuth';
import { LogoutButton } from '../components/LogoutButton';
import { Button } from '../components/ui/Button';
import { readDraft, useDraftWriter } from '../lib/drafts';
import { FinalStep } from '../onboarding/FinalStep';
import { LevelStep } from '../onboarding/LevelStep';
import { OnboardingLayout } from '../onboarding/OnboardingLayout';
import {
  ONBOARDING_DRAFT_SCOPE,
  finalStudyName,
  levelCopy,
  onboardingDraftSchema,
  onboardingStep,
  periodHeading,
  previousStep,
  programCopy,
  subjectsTitle,
  type OnboardingStep,
} from '../onboarding/onboardingModel';
import { PeriodStep } from '../onboarding/PeriodStep';
import { PrimaryUseStep } from '../onboarding/PrimaryUseStep';
import { ProgramStep } from '../onboarding/ProgramStep';
import { SubjectsStep } from '../onboarding/SubjectsStep';
import { useCompleteOnboarding, useProfile, useUpdateProfile } from '../profile/useProfile';
import { useStudyTracks } from '../studyTracks/useStudyTracks';
import { OFFLINE_MESSAGE } from '../pwa/pwaState';

const messageOf = (err: Error) => (isUnreachable(err) ? OFFLINE_MESSAGE : err.message);

/** The draft is private to a user: the wizard starts (and reads it) only once we know whose it is. */
export function OnboardingPage() {
  const userId = useMe().data?.id;
  if (!userId) return null;
  return <Onboarding key={userId} userId={userId} />;
}

/**
 * Onboarding: one question per screen, optional except the period, resumable. Which step comes next is DERIVED from what
 * the server knows (profile, current period) and the few things decided here (see `onboardingModel`): no counter is stored.
 *  USE -> PERIOD -> the optional steps of that use (program, level, subjects) -> FINAL.
 * Every answer is saved on the server as it is given (a failed save keeps what was typed and says so, and never moves on).
 * The subject names typed and not created yet, and the steps skipped, live in a local draft that survives reloads and is
 * cleared when the wizard ends. The wizard ends in COMPLETED ("I finished", not "everything is filled in"); a student who
 * skipped the profile ends without changing its status. Nobody is sent here because their profile is incomplete.
 */
function Onboarding({ userId }: { userId: string }) {
  const profile = useProfile();
  const home = useHomePeriod();
  const updateProfile = useUpdateProfile();
  const completeOnboarding = useCompleteOnboarding();
  // Only to tell the student, on the last screen, what completing will do (a study already set up changes that).
  const studies = useStudyTracks();
  const createPeriod = useCreatePeriod();
  const updatePeriod = useUpdatePeriod();
  const createSubjects = useCreateSubjectsBatch();

  // "Is there already the period that lets the app be used?" is the server's HOME period (never "any current one").
  const currentPeriod = home.data ?? null;
  const subjects = useSubjects(currentPeriod?.id);

  // What was decided here, and the subject names still to create: the local draft (read once, when the wizard opens).
  const [initial] = useState(
    () => readDraft(userId, ONBOARDING_DRAFT_SCOPE, onboardingDraftSchema)?.payload,
  );
  const [decided, setDecided] = useState<Set<string>>(() => new Set(initial?.decided ?? []));
  const [chips, setChips] = useState<string[]>(() => initial?.subjects ?? []);
  const draft = useDraftWriter(userId, ONBOARDING_DRAFT_SCOPE);
  const [view, setView] = useState<OnboardingStep | null>(null); // "Atrás": a step the student went back to

  const keep = (nextDecided: Set<string>, nextChips: string[]) => {
    setDecided(nextDecided);
    setChips(nextChips);
    draft.save({ decided: [...nextDecided], subjects: nextChips });
  };
  const decide = (step: string, nextChips = chips) => {
    keep(new Set(decided).add(step), nextChips);
    setView(null);
  };

  const [selected, setSelected] = useState<PrimaryUse | null>(null);
  const [errors, setErrors] = useState<Partial<Record<OnboardingStep, string>>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [summary, setSummary] = useState<{ created: number; reused: number } | null>(null);
  const [leavingTo, setLeavingTo] = useState<string | null>(null);
  // The last screen is saving COMPLETED: until it is saved the student stays on it, and "nothing is missing" must not redirect.
  const [finishing, setFinishing] = useState(false);
  const fail = (step: OnboardingStep) => (err: Error) =>
    setErrors((e) => ({ ...e, [step]: messageOf(err) }));
  const clearError = (step: OnboardingStep) => setErrors((e) => ({ ...e, [step]: undefined }));

  // Whether the account has any study decides if the program step exists, so it must be KNOWN first: while the list loads
  // there is no step (never "no studies yet").
  const hasStudies = (studies.data?.length ?? 0) > 0;
  const facts = useMemo(
    () =>
      profile.data && home.data !== undefined && studies.data !== undefined
        ? { profile: profile.data, period: currentPeriod, decided, hasStudies }
        : null,
    [profile.data, home.data, currentPeriod, decided, studies.data, hasStudies],
  );
  const derived = facts ? onboardingStep(facts) : null;
  // A step the student went back to ("Atrás") stays, except the program once a study exists: it is no longer asked.
  const derivedOrView = view === 'PROGRAM' && hasStudies ? derived : (view ?? derived);
  const step = derivedOrView === 'DONE' && finishing ? 'FINAL' : derivedOrView;

  // Moving to another step: the heading announces it (and takes the focus).
  const heading = useRef<HTMLHeadingElement>(null);
  const previous = useRef(step);
  useEffect(() => {
    if (previous.current !== null && step !== null && previous.current !== step) {
      heading.current?.focus();
    }
    previous.current = step;
  }, [step]);

  if (profile.isPending || home.isPending || studies.isPending) {
    return <FullPageMessage>Cargando…</FullPageMessage>;
  }
  if (
    (profile.isError && !profile.data) ||
    (home.isError && home.data === undefined) ||
    (studies.isError && !studies.data)
  ) {
    const failed =
      profile.isError && !profile.data
        ? profile
        : home.isError && home.data === undefined
          ? home
          : studies;
    return (
      <RetryMessage
        text={`No se pudo cargar: ${failed.error!.message}`}
        error={failed.error!}
        onRetry={() => {
          void profile.refetch();
          void home.refetch();
          void studies.refetch();
        }}
      />
    );
  }
  if (!profile.data || home.data === undefined || !facts || !step) return null;
  if (leavingTo) return <Navigate to={leavingTo} replace />;
  if (step === 'DONE') return <Navigate to="/dashboard" replace />; // finished before: nothing to chase

  const use = profile.data.primaryUse;
  const back = previousStep(step, facts);
  const footer = (
    <>
      {back && (
        <Button variant="ghost" onClick={() => setView(back)}>
          Atrás
        </Button>
      )}
      <LogoutButton className={back ? '' : '-ml-3'} />
    </>
  );
  const frame = (title: string, body: React.ReactNode, intro?: string) => (
    <OnboardingLayout
      ref={heading}
      step={step}
      primaryUse={use}
      hasStudies={hasStudies}
      title={title}
      intro={intro}
      footer={footer}
    >
      {body}
    </OnboardingLayout>
  );

  // ── 1. what the app is for ──
  function pickUse(value: PrimaryUse) {
    setSelected(value);
    clearError('USE');
    updateProfile.mutate(
      { primaryUse: value, onboardingStatus: 'IN_PROGRESS' },
      { onSuccess: () => setView(null), onError: fail('USE') },
    );
  }
  function skipUse() {
    clearError('USE');
    if (use !== null) return setView(null); // already answered: going on without changing it
    updateProfile.mutate(
      { onboardingStatus: 'SKIPPED' },
      { onSuccess: () => decide('USE'), onError: fail('USE') },
    );
  }

  // ── 2. the period ──
  function savePeriod(input: { name: string; startDate: string; endDate: string }) {
    clearError('PERIOD');
    setFieldErrors({});
    createPeriod.mutate(input, {
      onError: (err) => {
        if (err instanceof ApiRequestError && err.code === 'VALIDATION_ERROR') {
          setFieldErrors(err.fieldErrors);
        }
        fail('PERIOD')(err);
      },
    });
  }

  // ── 3. program ──
  const programDone = { onSuccess: () => decide('PROGRAM'), onError: fail('PROGRAM') };
  const pickProgram = (entry: ProgramEntry) => {
    clearError('PROGRAM');
    updateProfile.mutate({ programKey: entry.key }, programDone); // the server derives the name from the key
  };
  const saveProgram = (name: string) => {
    clearError('PROGRAM');
    updateProfile.mutate({ programName: name }, programDone); // a program of their own: no key
  };

  // ── 4. level (saved in the CURRENT period) ──
  const saveLevel = (input: { studyLevel: number } | { studyLevelNote: string }) => {
    if (!currentPeriod) return;
    clearError('LEVEL');
    updatePeriod.mutate(
      { id: currentPeriod.id, input },
      { onSuccess: () => decide('LEVEL'), onError: fail('LEVEL') },
    );
  };

  // ── 5. subjects ──
  function confirmSubjects(names: string[]) {
    clearError('SUBJECTS');
    if (names.length === 0) return decide('SUBJECTS');
    keep(decided, names); // what was typed is kept even if the save fails
    createSubjects.mutate(
      { names },
      {
        onSuccess: (res) => {
          setSummary({ created: res.createdSubjects.length, reused: res.reusedSubjects.length });
          decide('SUBJECTS', []);
        },
        onError: fail('SUBJECTS'), // the names stay: nothing is lost
      },
    );
  }

  // ── 6. the end: ONE call finishes the onboarding on the server (it may create the primary study and adopt this period), the
  // draft is gone, and out. The student leaves ONLY after it succeeded: a failure keeps them here, with the error and a retry. ──
  async function finish(to: string) {
    if (finishing) return; // a second tap while it is saving must not call again
    clearError('FINAL');
    setFinishing(true);
    try {
      await completeOnboarding.mutateAsync();
      draft.clear();
      setLeavingTo(to); // only now: it is saved, so the Home reads the finished state
    } catch (err) {
      setFinishing(false);
      fail('FINAL')(err as Error);
    }
  }

  switch (step) {
    case 'USE':
      return frame(
        '¿Para qué quieres usar Academic Planner?',
        <PrimaryUseStep
          selected={selected ?? use}
          current={use}
          pending={updateProfile.isPending}
          error={errors.USE}
          onPick={pickUse}
          onSkip={skipUse}
        />,
        'Elige lo que más se parezca. Puedes cambiarlo después.',
      );
    case 'PERIOD':
      return frame(
        periodHeading(use),
        <PeriodStep
          primaryUse={use}
          pending={createPeriod.isPending}
          error={errors.PERIOD}
          serverFieldErrors={fieldErrors}
          onSubmit={savePeriod}
        />,
      );
    case 'PROGRAM':
      return frame(
        programCopy(use).title,
        <ProgramStep
          primaryUse={use}
          currentName={profile.data.programName}
          pending={updateProfile.isPending}
          error={errors.PROGRAM}
          onPickCatalog={pickProgram}
          onSaveCustom={saveProgram}
          onSkip={() => decide('PROGRAM')}
        />,
      );
    case 'LEVEL':
      return frame(
        levelCopy(use).title,
        <LevelStep
          primaryUse={use}
          current={{
            studyLevel: currentPeriod?.studyLevel ?? null,
            studyLevelNote: currentPeriod?.studyLevelNote ?? null,
          }}
          pending={updatePeriod.isPending}
          error={errors.LEVEL}
          onPickNumber={(n) => saveLevel({ studyLevel: n })}
          onSaveNote={(note) => saveLevel({ studyLevelNote: note })}
          onSkip={() => decide('LEVEL')}
        />,
      );
    case 'SUBJECTS': {
      if (subjects.isPending) return <FullPageMessage>Cargando…</FullPageMessage>;
      return frame(
        subjectsTitle(use),
        <SubjectsStep
          primaryUse={use}
          existing={(subjects.data ?? []).map((s) => s.name)}
          chips={chips}
          onChips={(next) => keep(decided, next)}
          pending={createSubjects.isPending}
          error={errors.SUBJECTS}
          onConfirm={confirmSubjects}
        />,
      );
    }
    case 'FINAL':
      return frame(
        'Listo para empezar',
        <FinalStep
          subjects={summary ?? undefined}
          studyName={finalStudyName(profile.data, studies.data?.length)}
          pending={updateProfile.isPending || finishing}
          error={errors.FINAL}
          onImport={() => void finish('/calendar/import')}
          onHome={() => void finish('/dashboard')}
        />,
      );
    default:
      return null;
  }
}
