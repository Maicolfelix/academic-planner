import type { Subject } from '@planner/core';
import { readableInk, withAlpha } from '../../lib/readableInk';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { PencilIcon, TrashIcon, UserIcon } from '../../components/ui/icons';

/** Up to two letters for a subject's tile: "Bases de Datos" → "BD", "Redes" → "RE" (a face of its own). */
export function initialsOf(name: string): string {
  const words = name.match(/\p{L}[\p{L}\p{N}]*/gu) ?? [];
  const significant = words.filter((w) => w.length > 2 || words.length === 1);
  const picked = (significant.length > 0 ? significant : words).slice(0, 2);
  if (picked.length === 1) return picked[0]!.slice(0, 2).toUpperCase();
  return (
    picked.map((w) => w[0]!.toUpperCase()).join('') || name.trim().charAt(0).toUpperCase() || '?'
  );
}

/**
 * A subject as an academic SPACE, not a row of a table: its color is the protagonist in moderation (a monogram tile, a
 * soft wash of the color in the corner and a quiet orb), the professor and the description when there are some, and two
 * compact actions. Only data the subject already has: no counts or extra queries. Static on purpose (there can be many
 * of these): the only motion is the response to a pointer.
 */
export function SubjectCard({
  subject,
  onEdit,
  onDelete,
}: {
  subject: Subject;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { color } = subject;
  return (
    <Card
      as="li"
      style={{
        backgroundImage: `radial-gradient(120% 80% at 0% 0%, ${withAlpha(color, 0.16)}, transparent 62%)`,
      }}
      className="group relative flex min-w-0 flex-col gap-3 overflow-hidden p-4 transition-shadow duration-(--duration-normal) ease-standard hover:shadow-lift"
    >
      {/* A faint orb of the subject's color in the corner. Decoration: hidden from assistive tech, never catches a tap. */}
      <span
        aria-hidden="true"
        style={{
          background: `radial-gradient(closest-side, ${withAlpha(color, 0.22)}, transparent)`,
        }}
        className="pointer-events-none absolute -top-12 -right-12 size-36 rounded-full"
      />

      <div className="relative flex items-start gap-3">
        <span
          aria-hidden="true"
          data-subject-swatch
          style={{ backgroundColor: color, color: readableInk(color) }}
          className="grid size-12 shrink-0 place-items-center rounded-2xl text-xl font-bold shadow-card transition-transform duration-(--duration-normal) ease-spring group-hover:scale-105 group-hover:-rotate-3"
        >
          {initialsOf(subject.name)}
        </span>
        <div className="min-w-0 pt-0.5">
          <h2 className="text-card-title break-words">{subject.name}</h2>
          {subject.professor && (
            <p className="mt-0.5 flex items-start gap-1.5 text-sm text-muted-foreground">
              <UserIcon className="mt-0.5 size-4 shrink-0" />
              <span className="break-words">Profesor: {subject.professor}</span>
            </p>
          )}
        </div>
      </div>

      {subject.description && (
        <p className="relative line-clamp-3 text-sm text-muted-foreground break-words">
          {subject.description}
        </p>
      )}

      <div className="relative mt-auto flex items-center gap-1 pt-1">
        <Button
          size="sm"
          aria-label={`Editar ${subject.name}`}
          onClick={onEdit}
          className="gap-1.5"
        >
          <PencilIcon />
          Editar
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Eliminar ${subject.name}`}
          onClick={onDelete}
          className="gap-1.5 text-danger"
        >
          <TrashIcon />
          Eliminar
        </Button>
      </div>
    </Card>
  );
}
