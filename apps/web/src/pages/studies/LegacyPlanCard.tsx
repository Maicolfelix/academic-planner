import { formatDateOnly, type AcademicPeriod } from '@planner/core';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { subjectsCountLabel } from '../../studies/studyModel';

/**
 * "Tu planificación actual": the period an account had before studies existed (it belongs to no study). It is not an error and
 * nothing is done to it by being shown: "Convertir en estudio" opens a form the student confirms. Not turning it into a study
 * is a perfectly good choice; it keeps working as it always did.
 */
export function LegacyPlanCard({
  period,
  subjectCount,
  onConvert,
}: {
  period: AcademicPeriod;
  subjectCount: number;
  onConvert: () => void;
}) {
  return (
    <Card as="section" variant="tinted" aria-labelledby="legacy-plan-title" className="p-4">
      <div className="flex flex-col gap-3">
        <div className="min-w-0">
          <h2 id="legacy-plan-title" className="text-section-title">
            Tu planificación actual
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Es lo que ya tienes organizado y todavía no pertenece a ningún estudio. Puedes
            convertirlo en uno sin perder ni copiar nada.
          </p>
        </div>
        <div className="flex flex-col gap-0.5 text-sm">
          <p className="font-medium break-words">{period.name}</p>
          <p className="text-muted-foreground">
            {formatDateOnly(period.startDate)} – {formatDateOnly(period.endDate)} ·{' '}
            {subjectsCountLabel(subjectCount)}
          </p>
        </div>
        <div>
          <Button variant="primary" onClick={onConvert}>
            Convertir en estudio
          </Button>
        </div>
      </div>
    </Card>
  );
}
