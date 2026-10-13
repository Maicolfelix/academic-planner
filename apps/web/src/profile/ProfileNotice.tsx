import type { Profile } from '@planner/core';
import { Link } from 'react-router';
import { Card } from '../components/ui/Card';
import { buttonStyles } from '../components/ui/buttonStyles';
import { useProfile } from './useProfile';

/**
 * The only nudge about the profile, and a quiet one: a line on the Home with a link, no modal and no toast.
 *  - never started: "Completa tu perfil";
 *  - started and not finished: "Continúa configurando tu perfil";
 *  - skipped or completed: nothing. SKIPPED means "do not insist": the student can open it again whenever they want.
 */
export function profileNotice(
  profile: Pick<Profile, 'onboardingStatus'>,
): { text: string; cta: string } | null {
  switch (profile.onboardingStatus) {
    case 'NOT_STARTED':
      return { text: 'Completa tu perfil', cta: 'Completar' };
    case 'IN_PROGRESS':
      return { text: 'Continúa configurando tu perfil', cta: 'Continuar' };
    default:
      return null;
  }
}

export function ProfileNotice() {
  const { data } = useProfile();
  const notice = data ? profileNotice(data) : null;
  if (!notice) return null;
  return (
    <Card
      variant="soft"
      as="section"
      aria-label="Tu perfil"
      className="flex flex-wrap items-center justify-between gap-2 px-4 py-2"
    >
      <p className="text-sm text-muted-foreground">{notice.text}</p>
      <Link to="/onboarding" className={buttonStyles({ variant: 'ghost', size: 'sm' })}>
        {notice.cta}
      </Link>
    </Card>
  );
}
