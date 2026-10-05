#!/usr/bin/env node
// Reproducible, offline security scan of the tracked files (nothing is sent anywhere).
//   node scripts/security-scan.mjs            scans `git ls-files`
//   node scripts/security-scan.mjs --root dir scans every file under `dir` (used to test the scanner itself)
// Exit code 1 when something is found. It is a tripwire for the obvious mistakes, not a substitute for review.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const say = (line) =>
  process.stdout.write(`${line}
`);

const rootArg = process.argv.indexOf('--root');
const root = rootArg > 0 ? path.resolve(process.argv[rootArg + 1]) : process.cwd();

function listFiles() {
  if (rootArg > 0) {
    return fs
      .readdirSync(root, { recursive: true, encoding: 'utf8' })
      .filter((f) => fs.statSync(path.join(root, f)).isFile());
  }
  return execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

const TEXT =
  /\.(ts|tsx|js|mjs|cjs|json|md|yml|yaml|env|example|sql|prisma|html|css|toml|txt)$|^\.env|^[^.]+$/i;
const SKIP = /(^|\/)(package-lock\.json|node_modules|dist|generated)(\/|$)/;

/** Secrets: a match is a finding unless the line is an obvious placeholder or the documented development default. */
const SECRET_PATTERNS = [
  ['private key block', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/],
  ['AWS access key id', /\bAKIA[0-9A-Z]{16}\b/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ['API key (sk-…)', /\bsk-[A-Za-z0-9]{20,}\b/],
  ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  [
    'credentials in a URL',
    /\b[a-z]+:\/\/[^\s:/@'"]+:[^\s:/@'"]{3,}@(?!localhost\b|127\.0\.0\.1\b|example\b)[^\s'"]+/i,
  ],
  [
    'hard-coded secret',
    /\b(?:api[_-]?key|secret|token|passwd|password)\b['"]?\s*[:=]\s*['"][A-Za-z0-9+/_-]{16,}['"]/i,
  ],
];
/** The one URL with credentials that is allowed: the local Docker database of the README / .env.example. */
const DEV_DB = /planner:planner@localhost/;

/** Code that is dangerous by construction in this project. */
const CODE_PATTERNS = [
  ['dangerouslySetInnerHTML', /dangerouslySetInnerHTML/, /\.(tsx|jsx)$/],
  ['innerHTML / outerHTML assignment', /\.(?:inner|outer)HTML\s*=/, /\.(tsx?|jsx?|mjs)$/],
  ['document.write', /document\.write\(/, /\.(tsx?|jsx?|mjs)$/],
  ['eval / new Function', /(?<![\w.])eval\(|new Function\(/, /\.(tsx?|jsx?|mjs)$/],
  ['unsafe raw SQL', /\$(?:query|execute)RawUnsafe/, /\.ts$/],
  [
    'password or token written to a log',
    /console\.\w+\([^)]*(?:password|passwordHash|tokenHash|cookie)/i,
    /\.ts$/,
  ],
  ['cookie set outside auth/cookies.ts', /res\.cookie\(/, /\.ts$/],
  ['wildcard CORS', /origin:\s*['"]\*['"]|Access-Control-Allow-Origin['"]?,\s*['"]\*/, /\.ts$/],
];
// Tests and the guarded test-database helper (table names come from the catalog, only runs on *_test) are not shipped.
const CODE_IGNORE = /(\.test\.|\.spec\.|security-scan\.mjs|docs\/|apps\/api\/test\/)/;

const findings = [];
for (const file of listFiles()) {
  const rel = file.replaceAll('\\', '/');
  if (SKIP.test(rel)) continue;
  // A committed .env (anything but the example) is a finding by itself.
  if (/(^|\/)\.env(\.[\w-]+)?$/.test(rel) && !rel.endsWith('.env.example'))
    findings.push([rel, 0, 'environment file is tracked']);
  if (!TEXT.test(rel)) continue;
  let text;
  try {
    text = fs.readFileSync(path.join(root, file), 'utf8');
  } catch {
    continue;
  }
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (line.length > 2000) return;
    for (const [name, re] of SECRET_PATTERNS) {
      if (
        re.test(line) &&
        !DEV_DB.test(line) &&
        !/example|placeholder|changeme|your[-_ ]|xxx|\.\.\.|<[^>]+>/i.test(line)
      ) {
        findings.push([rel, i + 1, `possible secret: ${name}`]);
      }
    }
    if (CODE_IGNORE.test(rel)) return;
    for (const [name, re, files] of CODE_PATTERNS) {
      if (
        files.test(rel) &&
        re.test(line) &&
        !(name.startsWith('cookie set') && rel.endsWith('auth/cookies.ts'))
      ) {
        findings.push([rel, i + 1, name]);
      }
    }
  });
}

if (findings.length === 0) {
  say('security-scan: nothing found');
} else {
  for (const [file, line, what] of findings) say(`${file}:${line}  ${what}`);
  say(`security-scan: ${findings.length} finding(s)`);
  process.exit(1);
}
