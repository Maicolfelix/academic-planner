import type { ReactNode } from 'react';
import { TickIcon, WarnIcon } from '../ui/icons';

const TONE = {
  success: 'border-success-line bg-success-soft text-success-ink',
  warning: 'border-warning-line bg-warning-soft text-warning-ink',
  danger: 'border-danger-line bg-danger-soft text-danger-ink',
} as const;

/**
 * A message above or inside a sign-in form: a soft tone, a thick edge of the same hue and a small pixel mark (a tick for good
 * news, a warning triangle otherwise). The words are the message; the mark and the colors only accompany them.
 */
export function AuthNotice({
  tone,
  role,
  children,
}: {
  tone: keyof typeof TONE;
  role: 'status' | 'alert';
  children: ReactNode;
}) {
  const Mark = tone === 'success' ? TickIcon : WarnIcon;
  return (
    <p
      role={role}
      className={`flex items-start gap-2.5 rounded-control border border-l-4 p-3 text-sm ${TONE[tone]}`}
    >
      <Mark className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}
