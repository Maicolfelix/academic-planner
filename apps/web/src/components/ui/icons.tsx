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

/*
 * UX1-3 added the action icons (check, pencil, calendar+, trash, more, chevron, user, sliders): 13 small shapes in all.
 * Still cheaper to keep as eight lines of path each than a dependency (see docs/ux-accessibility.md, "Iconos").
 */
type IconProps = { className?: string };

export const CheckIcon = ({ className = 'size-4' }: IconProps) => (
  <Icon className={className}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Icon>
);

export const PencilIcon = ({ className = 'size-4' }: IconProps) => (
  <Icon className={className}>
    <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" />
    <path d="m13.5 6.5 4 4" />
  </Icon>
);

export const CalendarPlusIcon = ({ className = 'size-4' }: IconProps) => (
  <Icon className={className}>
    <rect x="3" y="5" width="18" height="16" rx="3" />
    <path d="M3 10h18M8 3v4M16 3v4M12 13v5M9.5 15.5h5" />
  </Icon>
);

export const TrashIcon = ({ className = 'size-4' }: IconProps) => (
  <Icon className={className}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
  </Icon>
);

export const MoreIcon = ({ className = 'size-5' }: IconProps) => (
  <Icon className={className}>
    <circle cx="5" cy="12" r="1.2" fill="currentColor" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" />
    <circle cx="19" cy="12" r="1.2" fill="currentColor" />
  </Icon>
);

export const ChevronDownIcon = ({ className = 'size-4' }: IconProps) => (
  <Icon className={className}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
);

export const UserIcon = ({ className = 'size-4' }: IconProps) => (
  <Icon className={className}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20a7 7 0 0 1 14 0" />
  </Icon>
);

export const SlidersIcon = ({ className = 'size-4' }: IconProps) => (
  <Icon className={className}>
    <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
    <circle cx="15" cy="7" r="2" />
    <circle cx="9" cy="17" r="2" />
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
