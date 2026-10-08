import type { ReactNode } from 'react';

/*
 * The app's icons are inline SVG: five tiny shapes, no dependency, no bundle cost and nothing to keep up to date.
 * They are decoration: always `aria-hidden`, and whatever they sit in carries the text (a nav item is "icon +
 * label", never icon alone). When the set grows past a dozen or so (notifications, profile…) a library such as
 * lucide-react becomes the smaller thing to maintain: decide it then, in that PR.
 */
function Icon({ children, className = 'size-6' }: { children: ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {children}
    </svg>
  );
}

export const HomeIcon = () => (
  <Icon>
    <path d="m3 11 9-8 9 8" />
    <path d="M5 10v10h14V10" />
    <path d="M10 20v-5h4v5" />
  </Icon>
);

export const CheckSquareIcon = () => (
  <Icon>
    <rect x="3" y="3" width="18" height="18" rx="4" />
    <path d="m8 12 3 3 5-6" />
  </Icon>
);

export const CalendarIcon = () => (
  <Icon>
    <rect x="3" y="5" width="18" height="16" rx="3" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </Icon>
);

export const BookIcon = () => (
  <Icon>
    <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" />
    <path d="M5 17a3 3 0 0 1 3-3h11" />
  </Icon>
);

/** Two sparks: "write it in a sentence and I will organize it" (Quick Capture). */
export const SparkIcon = ({ className = 'size-5' }: { className?: string }) => (
  <Icon className={className}>
    <path d="M9 3v4M7 5h4M17 12v6M14 15h6M10 12l-3 3M19 4l-2 2" />
  </Icon>
);

/** The product mark: a rounded square with a check, the same idea as the favicon. */
export const BrandMark = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="size-7 text-primary">
    <rect width="24" height="24" rx="6" fill="currentColor" />
    <path
      d="m7.5 12.5 3 3 6-7"
      fill="none"
      className="stroke-primary-foreground"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
