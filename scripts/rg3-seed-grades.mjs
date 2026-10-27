#!/usr/bin/env node
// RG-3 backup/restore helper: creates SYNTHETIC grading data (study, period, subject, scale, cuts, one scored evaluation) through
// the public API of a RUNNING throw-away stack, so the restore check can cover notes and cuts (the smoke does not create them).
//
//   node scripts/rg3-seed-grades.mjs http://127.0.0.1:4310
//
// It needs nothing but the URL: one account (…@qa.planner.invalid) per run, no secrets printed, nothing outside the API touched.

const baseUrl = (process.argv[2] ?? '').replace(/\/+$/, '');
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(baseUrl)) {
  console.error(
    'Usage: node scripts/rg3-seed-grades.mjs http://127.0.0.1:<port>  (local throw-away stacks only)',
  );
  process.exit(2);
}
let cookie = '';
async function call(method, path, body) {
  const res = await fetch(baseUrl + path, {
    method,
    headers: {
      origin: baseUrl,
      ...(body !== undefined && { 'content-type': 'application/json' }),
      ...(cookie && { cookie }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => undefined);
  const set = res.headers.getSetCookie().find((c) => /academic_planner_session=/.test(c));
  if (set) cookie = set.split(';')[0];
  return { status: res.status, json };
}
function must(res, expected, what) {
  if (res.status !== expected) {
    console.error(`FAIL ${what}: HTTP ${res.status} ${res.json?.error?.code ?? ''}`);
    process.exit(1);
  }
  return res.json;
}

const tag = Date.now().toString(36);
const iso = (d) => d.toISOString().slice(0, 10);
const now = Date.now();
must(
  await call('POST', '/api/auth/register', {
    name: 'QA Grades',
    email: `grades-${tag}@qa.planner.invalid`,
    password: `grades-${tag}-correct-horse`,
  }),
  201,
  'register',
);
const track = must(
  await call('POST', '/api/study-tracks', { name: 'Medicina QA', type: 'UNIVERSITY' }),
  201,
  'study',
).studyTrack;
const period = must(
  await call('POST', '/api/periods', {
    name: 'QA notas',
    startDate: iso(new Date(now - 30 * 864e5)),
    endDate: iso(new Date(now + 90 * 864e5)),
    isCurrent: true,
    studyTrackId: track.id,
  }),
  201,
  'period',
).period;
const subject = must(
  await call('POST', '/api/subjects', { periodId: period.id, name: 'Farmacología QA' }),
  201,
  'subject',
).subject;
must(
  await call('POST', `/api/periods/${period.id}/grading`, {
    minMilli: 0,
    maxMilli: 5000,
    passMilli: 3000,
    decimals: 1,
  }),
  201,
  'scale',
);
const cuts = must(
  await call('POST', `/api/subjects/${subject.id}/grading/setup`, {
    gradingPeriods: [
      { name: 'Corte 1', finalShareBp: 3000 },
      { name: 'Corte 2', finalShareBp: 3000 },
      { name: 'Corte 3', finalShareBp: 4000 },
    ],
  }),
  201,
  'cuts',
).gradingPeriods;
must(
  await call('POST', '/api/evaluations', {
    subjectId: subject.id,
    gradingPeriodId: cuts[0].id,
    name: 'Parcial QA',
    periodShareBp: 10000,
    scoreMilli: 4000,
  }),
  201,
  'evaluation',
);
console.log('seeded: 1 study, 1 period, 1 subject, scale, 3 cuts, 1 scored evaluation');
