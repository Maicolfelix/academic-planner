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

/** The pictures, one row of text per row of squares. Also drawn big, in the empty states. */
export const PIXELS = {
  home: [
    '.....##.....',
    '....####....',
    '...######...',
    '..########..',
    '.##########.',
    '############',
    '..########..',
    '..########..',
    '..###..###..',
    '..###..###..',
    '..###..###..',
  ],
  check: [
    '.##########.',
    '#..........#',
    '#........#.#',
    '#.......#..#',
    '#......#...#',
    '#.#...#....#',
    '#..#.#.....#',
    '#...#......#',
    '#..........#',
    '#..........#',
    '.##########.',
  ],
  calendar: [
    '..#......#..',
    '..#......#..',
    '############',
    '#..........#',
    '############',
    '#..........#',
    '#.##.##.##.#',
    '#..........#',
    '#.##.##.##.#',
    '#..........#',
    '############',
  ],
  book: [
    '.#########..',
    '#.........#.',
    '#.#####...#.',
    '#.........#.',
    '#.####....#.',
    '#.........#.',
    '#.........#.',
    '#.........#.',
    '#.........#.',
    '.##########.',
  ],
  radar: [
    '...######...',
    '..#......#..',
    '.#.....#..#.',
    '#.....#....#',
    '#....#.....#',
    '#...##.....#',
    '#...##.....#',
    '#..........#',
    '.#........#.',
    '..#......#..',
    '...######...',
  ],
  inbox: [
    '.##########.',
    '#..........#',
    '#..........#',
    '#..........#',
    '#..........#',
    '###......###',
    '#..######..#',
    '#..........#',
    '############',
  ],
  logout: [
    '#####.......',
    '#...#.......',
    '#...#..#....',
    '#...#...#...',
    '#...#######.',
    '#...#...#...',
    '#...#..#....',
    '#...#.......',
    '#####.......',
  ],
  lock: [
    '...####.....',
    '..#....#....',
    '..#....#....',
    '..#....#....',
    '############',
    '############',
    '#####..#####',
    '#####..#####',
    '############',
    '############',
  ],
  user: [
    '....####....',
    '...######...',
    '...######...',
    '....####....',
    '............',
    '..########..',
    '.##########.',
    '############',
    '############',
  ],
  enter: [
    '.......#....',
    '........#...',
    '.........#..',
    '###########.',
    '.........#..',
    '........#...',
    '.......#....',
  ],
  tick: [
    '..........##',
    '.........##.',
    '##......##..',
    '.##....##...',
    '..##..##....',
    '...####.....',
    '....##......',
  ],
  warn: [
    '.....##.....',
    '.....##.....',
    '....####....',
    '....#..#....',
    '...######...',
    '...##..##...',
    '..###..###..',
    '.####..####.',
    '############',
  ],
  left: [
    '.......##...',
    '......##....',
    '.....##.....',
    '....##......',
    '.....##.....',
    '......##....',
    '.......##...',
  ],
  right: [
    '...##.......',
    '....##......',
    '.....##.....',
    '......##....',
    '.....##.....',
    '....##......',
    '...##.......',
  ],
  cap: [
    '.....##.....',
    '...######...',
    '.##########.',
    '############',
    '.##########.',
    '...######...',
    '...#.##.#...',
    '...######...',
  ],
  chart: [
    '.........##.',
    '.........##.',
    '.....##..##.',
    '.....##..##.',
    '.....##..##.',
    '.##..##..##.',
    '.##..##..##.',
    '.##..##..##.',
    '############',
  ],
} as const;

/**
 * The big icons (navigation and screen headers) are PIXEL art, drawn on a 12-wide grid like the companion: the same hand
 * everywhere. Each `#` is one square; runs on a row merge into one rectangle. Crisp edges, `currentColor`, decoration.
 */
export function PixelIcon({
  rows,
  className = 'size-6',
}: {
  rows: readonly string[];
  className?: string;
}) {
  const d = rows
    .flatMap((row, y) =>
      [...row.matchAll(/#+/g)].map((m) => `M${m.index} ${y}h${m[0].length}v1h-${m[0].length}z`),
    )
    .join('');
  return (
    <svg
      viewBox={`0 0 12 ${rows.length}`}
      fill="currentColor"
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d={d} />
    </svg>
  );
}

export const HomeIcon = () => <PixelIcon rows={PIXELS.home} />;

export const CheckSquareIcon = () => <PixelIcon rows={PIXELS.check} />;

export const CalendarIcon = () => <PixelIcon rows={PIXELS.calendar} />;

export const BookIcon = () => <PixelIcon rows={PIXELS.book} />;

/** The Radar: a ring and a sweep. */
export const RadarIcon = () => <PixelIcon rows={PIXELS.radar} />;

/** The Bandeja: a tray that receives. */
export const InboxIcon = () => <PixelIcon rows={PIXELS.inbox} />;

/** Mis estudios: a graduation cap. */
export const CapIcon = ({ className }: { className?: string }) => (
  <PixelIcon rows={PIXELS.cap} className={className} />
);

/** The sign-in and sign-up pictures and the small marks of a message. */
export const LockIcon = () => <PixelIcon rows={PIXELS.lock} />;
export const UserPixelIcon = () => <PixelIcon rows={PIXELS.user} />;
export const EnterIcon = ({ className }: { className?: string }) => (
  <PixelIcon rows={PIXELS.enter} className={className} />
);
export const TickIcon = ({ className }: { className?: string }) => (
  <PixelIcon rows={PIXELS.tick} className={className} />
);
export const WarnIcon = ({ className }: { className?: string }) => (
  <PixelIcon rows={PIXELS.warn} className={className} />
);

/** Cerrar sesión: an arrow leaving through a door. */
export const LogoutIcon = ({ className }: { className?: string }) => (
  <PixelIcon rows={PIXELS.logout} className={className} />
);

/** Progreso: three rising bars on a baseline. */
export const ChartIcon = () => <PixelIcon rows={PIXELS.chart} />;

/** Two sparks: "write it in a sentence and I will organize it" (Quick Capture). */
export const SparkIcon = ({ className = 'size-5' }: { className?: string }) => (
  <Icon className={className}>
    <path d="M9 3v4M7 5h4M17 12v6M14 15h6M10 12l-3 3M19 4l-2 2" />
  </Icon>
);

/*
 * UX1-3 added the action icons (check, pencil, calendar+, trash, more, chevron, user, sliders) and UX1-4 the alert
 * triangle of the form errors and the notification polish the bell: 15 small shapes in all.
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

export const AlertIcon = ({ className = 'size-4' }: IconProps) => (
  <Icon className={className}>
    <path d="M12 4 3 20h18z" />
    <path d="M12 10v4M12 17.2v.1" />
  </Icon>
);

/** A bell (reminders). Same stroke as the navigation icons; decoration only, whatever it sits in carries the text. */
export const BellIcon = ({ className = 'size-4' }: IconProps) => (
  <Icon className={className}>
    <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" />
    <path d="M10 21a2 2 0 0 0 4 0" />
  </Icon>
);
