// `node --test scripts` — the checker must FAIL on a broken link and pass on a good one.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';

const script = fileURLToPath(new URL('./docs-check.mjs', import.meta.url));

function check(files, scripts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-check-'));
  try {
    for (const [name, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      fs.writeFileSync(path.join(dir, name), text);
    }
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts }));
    return spawnSync(process.execPath, [script, '--root', dir], { encoding: 'utf8' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('a correct set of documents passes', () => {
  const run = check(
    {
      'README.md':
        '# A\n\nVer [b](docs/b.md#segunda-sección) y `docs/b.md`. Corre `npm run build`.\n',
      'docs/b.md': '# B\n\n## Segunda sección\n',
    },
    { build: 'x' },
  );
  assert.equal(run.status, 0, run.stdout);
});

test('a link to a file that does not exist fails', () => {
  const run = check({ 'README.md': '[x](docs/missing.md)\n' });
  assert.equal(run.status, 1);
  assert.match(run.stdout, /link to missing file: docs\/missing\.md/);
});

test('a link to a heading that does not exist fails', () => {
  const run = check({ 'README.md': '[x](docs/b.md#nope)\n', 'docs/b.md': '# B\n' });
  assert.equal(run.status, 1);
  assert.match(run.stdout, /missing heading/);
});

test('a referenced file in code that does not exist fails', () => {
  const run = check({ 'README.md': 'Mira `apps/api/src/nada.ts`.\n' });
  assert.equal(run.status, 1);
  assert.match(run.stdout, /referenced file does not exist/);
});

test('an npm script that does not exist fails', () => {
  const run = check({ 'README.md': '```bash\nnpm run fantasma\n```\n' }, { build: 'x' });
  assert.equal(run.status, 1);
  assert.match(run.stdout, /npm script "fantasma" does not exist/);
});
