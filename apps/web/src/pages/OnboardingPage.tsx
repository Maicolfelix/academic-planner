import type { PrimaryUse } from '@planner/core';
import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useCreatePeriod, usePeriods } from '../academic/useAcademic';
import { ApiRequestError } from '../api/client';
import { FullPageMessage, isUnreachable, RetryMessage } from '../auth/guards';
import { LogoutButton } from '../components/LogoutButton';
import { OnboardingLayout } from '../onboarding/OnboardingLayout';
import { onboardingStep, periodHeading } from '../onboarding/onboardingModel';
import { PeriodStep } from '../onboarding/PeriodStep';
import { PrimaryUseStep } from '../onboarding/PrimaryUseStep';
import { useProfile, useUpdateProfile } from '../profile/useProfile';
import { OFFLINE_MESSAGE } from '../pwa/pwaState';

const messageOf = (err: Error) => (isUnreachable(err) ? OFFLINE_MESSAGE : err.message);

/**
 * Onboarding, one question per screen, always skippable and always resumable: the step is DERIVED from what the server
 * already knows (the profile and the periods), so closing the browser and coming back continues where it was.
 *  1. USE: what the app is for (saved with `PATCH /api/profile`; skipping saves SKIPPED and goes on);
 *  2. PERIOD: the current period (mandatory: the rest of the app hangs from it).
 * A new account lands here from the registration. A signed-in student who already has a period can open it by hand to
 * answer the question; nobody is ever sent here because their profile is incomplete (only the missing period, as before).
 * After the period it goes to the subjects, as it always did; the status stays IN_PROGRESS on purpose (more steps are coming).
 */
export function OnboardingPage() {
  const navigate = useNavigate();
  const profile = useProfile();
  const periods = usePeriods();
  const updateProfile = useUpdateProfile();
  const createPeriod = useCreatePeriod();

  const [selected, setSelected] = useState<PrimaryUse | null>(null);
  const [useError, setUseError] = useState<string>();
  const [periodError, setPeriodError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  // Where we are leaving to: while it is set, "nothing is missing" must not redirect somewhere else (the cache refreshes
  // BEFORE the request that is finishing reports success).
  const [leavingTo, setLeavingTo] = useState<string | null>(null);

  const hasPeriod = periods.data?.some((p) => p.isCurrent) ?? false;
  const step = profile.data && periods.data ? onboardingStep(profile.data, hasPeriod) : null;

  // Moving to another step: the heading announces it (and takes the focus).
  const heading = useRef<HTMLHeadingElement>(null);
  const previous = useRef(step);
  useEffect(() => {
    if (previous.current !== null && step !== null && previous.current !== step)
      heading.current?.focus();
    previous.current = step;
  }, [step]);

  if (profile.isPending || periods.isPending) return <FullPageMessage>Cargando…</FullPageMessage>;
  if ((profile.isError && !profile.data) || (periods.isError && !periods.data)) {
    const failed = profile.isError && !profile.data ? profile : periods;
    return (
      <RetryMessage
        text={`No se pudo cargar: ${failed.error!.message}`}
        error={failed.error!}
        onRetry={() => {
          void profile.refetch();
          void periods.refetch();
        }}
      />
    );
  }
  if (!profile.data || !periods.data || step === null) return null;

  if (step === 'DONE') {
    // Nothing is missing. (While the student is leaving by their own action, that action decides where to.)
    return leavingTo ? null : <Navigate to="/dashboard" replace />;
  }

  function pick(value: PrimaryUse) {
    setSelected(value);
    setUseError(undefined);
    if (hasPeriod) setLeavingTo('/dashboard');
    // One logical intention, one request: the answer AND "started" (a valid step from every state).
    updateProfile.mutate(
      { primaryUse: value, onboardingStatus: 'IN_PROGRESS' },
      {
        onSuccess: () => {
          if (hasPeriod) navigate('/dashboard', { replace: true });
        },
        onError: (err) => {
          setLeavingTo(null);
          setUseError(messageOf(err)); // the choice stays marked
        },
      },
    );
  }

  function skip() {
    setUseError(undefined);
    if (hasPeriod) setLeavingTo('/dashboard');
    updateProfile.mutate(
      { onboardingStatus: 'SKIPPED' },
      {
        onSuccess: () => {
          if (hasPeriod) navigate('/dashboard', { replace: true });
        },
        onError: (err) => {
          setLeavingTo(null);
          setUseError(messageOf(err));
        },
      },
    );
  }

  function savePeriod(input: { name: string; startDate: string; endDate: string }) {
    setPeriodError(undefined);
    setFieldErrors({});
    setLeavingTo('/subjects');
    createPeriod.mutate(input, {
      onSuccess: () => navigate('/subjects', { replace: true }),
      onError: (err) => {
        setLeavingTo(null);
        if (err instanceof ApiRequestError && err.code === 'VALIDATION_ERROR') {
          setFieldErrors(err.fieldErrors);
        }
        setPeriodError(messageOf(err));
      },
    });
  }

  if (step === 'USE') {
    return (
      <OnboardingLayout
        ref={heading}
        step="USE"
        title="¿Para qué quieres usar Academic Planner?"
        intro="Elige lo que más se parezca. Puedes cambiarlo después."
        footer={<LogoutButton className="-ml-3" />}
      >
        <PrimaryUseStep
          selected={selected}
          pending={updateProfile.isPending}
          error={useError}
          onPick={pick}
          onSkip={skip}
        />
      </OnboardingLayout>
    );
  }

  return (
    <OnboardingLayout
      ref={heading}
      step="PERIOD"
      title={periodHeading(profile.data.primaryUse)}
      footer={<LogoutButton className="-ml-3" />}
    >
      <PeriodStep
        primaryUse={profile.data.primaryUse}
        pending={createPeriod.isPending}
        error={periodError}
        serverFieldErrors={fieldErrors}
        onSubmit={savePeriod}
      />
    </OnboardingLayout>
  );
}
