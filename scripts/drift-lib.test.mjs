import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyDrift, diffLines, KNOWN_DRIFT } from './drift-lib.mjs';

const BANNER = 'Loaded Prisma config from prisma.config.ts.\n\n';
const known = (extra = []) => `${BANNER}${[...KNOWN_DRIFT, ...extra].join('\n')}\n`;
const NONE = `${BANNER}No difference detected.\n`;

test('the known difference is exactly the hand-written Evaluation -> Activity foreign key', () => {
  assert.deepEqual(KNOWN_DRIFT, [
    '[*] Changed the `Evaluation` table',
    '[-] Removed foreign key on columns (activityId, subjectId)',
  ]);
});

test('1. "No difference detected" passes', () => {
  const r = classifyDrift({ status: 0, stdout: NONE });
  assert.deepEqual([r.ok, r.kind], [true, 'none']);
});

test('2. exactly the known difference passes (exit 2), with or without Prisma banners, in any order', () => {
  for (const stdout of [
    known(),
    KNOWN_DRIFT.join('\n'),
    `${BANNER}${[...KNOWN_DRIFT].reverse().join('\n')}\n`,
    known().replace(/\n/g, '\r\n'),
  ]) {
    const r = classifyDrift({ status: 2, stdout });
    assert.deepEqual([r.ok, r.kind], [true, 'known'], stdout);
  }
});

test('3. the known difference PLUS one more line fails', () => {
  for (const extra of [
    '[+] Added index on columns (userId) on the `Activity` table',
    '[-] Removed foreign key on columns (userId)',
    '[*] Changed the `Subject` table',
  ]) {
    const r = classifyDrift({ status: 2, stdout: known([extra]) });
    assert.deepEqual([r.ok, r.kind], [false, 'unexpected'], extra);
    assert.match(r.detail, /unexpected drift/);
  }
});

test('4. only one of the two known lines fails', () => {
  for (const line of KNOWN_DRIFT) {
    const r = classifyDrift({ status: 2, stdout: `${BANNER}${line}\n` });
    assert.equal(r.ok, false, line);
  }
});

test('5. another foreign key (or any other single difference) fails', () => {
  for (const stdout of [
    '[*] Changed the `Evaluation` table\n[-] Removed foreign key on columns (gradingPeriodId, subjectId)',
    '[*] Changed the `Activity` table\n[-] Removed foreign key on columns (activityId, subjectId)',
    '[*] Changed the `Evaluation` table\n[-] Removed foreign key on columns (activityId, subjectId, periodId)',
    '[+] Added tables\n  - Surprise',
    '[-] Removed index on columns (userId)\n[*] Changed the `Evaluation` table',
    '[*] Changed the `Evaluation` table\n[*] Changed the `Evaluation` table\n[-] Removed foreign key on columns (activityId, subjectId)',
  ]) {
    assert.equal(classifyDrift({ status: 2, stdout }).ok, false, stdout);
  }
});

test('6. an unexpected exit code fails, even when the text looks fine', () => {
  for (const status of [1, 3, null, undefined, 137]) {
    assert.equal(classifyDrift({ status, stdout: known() }).ok, false, String(status));
    assert.equal(classifyDrift({ status, stdout: NONE }).ok, false, String(status));
  }
  // exit 0 must really say there is nothing; exit 2 with no recognizable change lines is not "known"
  assert.equal(classifyDrift({ status: 0, stdout: known() }).ok, false);
  assert.equal(classifyDrift({ status: 2, stdout: NONE }).ok, false);
  assert.equal(classifyDrift({ status: 2, stdout: '' }).ok, false);
});

test('strict mode (requireZero) accepts only "No difference detected": not even the known difference', () => {
  assert.equal(classifyDrift({ status: 0, stdout: NONE }, { requireZero: true }).ok, true);
  const r = classifyDrift({ status: 2, stdout: known() }, { requireZero: true });
  assert.deepEqual([r.ok, r.kind], [false, 'known']);
  assert.equal(
    classifyDrift({ status: 2, stdout: known(['[+] extra']) }, { requireZero: true }).ok,
    false,
  );
});

test('there is no way to accept arbitrary drift: the helper takes no list of extra lines', () => {
  assert.equal(
    classifyDrift.length,
    1,
    'only the diff is required; the options carry a single boolean',
  );
  const r = classifyDrift(
    { status: 2, stdout: known(['[+] Added index']) },
    { requireZero: false, acceptAnything: true },
  );
  assert.equal(r.ok, false);
});

test('diffLines keeps only the change lines', () => {
  assert.deepEqual(diffLines(`${BANNER}  [-] a\n[+] b\nnoise [*] not a line start\n`), [
    '[-] a',
    '[+] b',
  ]);
  assert.deepEqual(diffLines(undefined), []);
});
