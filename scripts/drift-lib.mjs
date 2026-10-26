// The decision of the fresh-database validation about `prisma migrate diff` (database after the migrations vs schema.prisma).
// Pure on purpose: tested in drift-lib.test.mjs. No network, no Docker, no globals.
//
// The migrations are the real source of the manual SQL invariants (partial unique indexes, CHECK constraints, a composite
// foreign key); schema.prisma cannot express some of them, so a diff is NOT expected to be empty. ONE difference is known,
// reviewed and accepted: the hand-written composite foreign key Evaluation(activityId, subjectId) -> Activity(id, subjectId)
// with ON DELETE SET NULL ("activityId") (migration 20261015203000_grading_foundation). Anything else is unexpected and blocks.

/** Exactly the diff lines `prisma migrate diff` prints for that one accepted difference. */
export const KNOWN_DRIFT = [
  '[*] Changed the `Evaluation` table',
  '[-] Removed foreign key on columns (activityId, subjectId)',
];

/** The change lines of a diff (`[*]`, `[+]`, `[-]`), trimmed; anything else Prisma prints (banners, warnings) is not a change. */
export const diffLines = (stdout) =>
  (String(stdout ?? '').match(/^\s*\[[*+-]\].*$/gm) ?? []).map((line) => line.trim());

const sameSet = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

/**
 * @param {{ status: number | null, stdout: string }} diff the result of `prisma migrate diff ... --exit-code`
 * @param {{ requireZero?: boolean }} [options] `requireZero`: not even the known difference is accepted
 * @returns {{ ok: boolean, kind: 'none' | 'known' | 'unexpected', detail: string }}
 */
export function classifyDrift(diff, { requireZero = false } = {}) {
  const lines = diffLines(diff.stdout);
  if (diff.status === 0) {
    return lines.length === 0 && /No difference detected/i.test(String(diff.stdout))
      ? { ok: true, kind: 'none', detail: 'no difference at all' }
      : {
          ok: false,
          kind: 'unexpected',
          detail: 'exit 0 but the output is not "No difference detected"',
        };
  }
  if (diff.status === 2) {
    if (sameSet(lines, KNOWN_DRIFT)) {
      return requireZero
        ? {
            ok: false,
            kind: 'known',
            detail: `zero drift required, but the known one is present: ${KNOWN_DRIFT.join(' / ')}`,
          }
        : {
            ok: true,
            kind: 'known',
            detail: `only the known, accepted difference: ${KNOWN_DRIFT.join(' / ')}`,
          };
    }
    return {
      ok: false,
      kind: 'unexpected',
      detail: `unexpected drift: ${lines.join(' / ') || String(diff.stdout ?? '').slice(0, 300)}`,
    };
  }
  return { ok: false, kind: 'unexpected', detail: `unexpected exit code ${diff.status}` };
}
