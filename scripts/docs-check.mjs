#!/usr/bin/env node
// Lightweight, offline documentation checks (no dependencies, nothing is sent anywhere).
//   node scripts/docs-check.mjs              checks the repository
//   node scripts/docs-check.mjs --root dir   checks the markdown under `dir` (used to test the checker itself)
// It verifies, in README.md, CLAUDE.md, CHANGELOG.md, ARCHITECTURE_PLAN_v1.md and docs/**/*.md:
//   1. relative markdown links point to a file that exists (and, for .md targets, to a heading that exists);
//   2. repository paths written in `code` (apps/…, packages/…, docs/…, e2e/…, scripts/…) exist;
//   3. every `npm run <script>` mentioned exists in the root package.json (or in the workspace given with -w).
// It cannot tell whether a sentence is TRUE: it only catches what rots silently. Exit code 1 when something is found.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const say = (line) =>
  process.stdout.write(`${line}
`);

const rootArg = process.argv.indexOf('--root');
const root = rootArg > 0 ? path.resolve(process.argv[rootArg + 1]) : process.cwd();

const ROOT_DOCS = ['README.md', 'CLAUDE.md', 'CHANGELOG.md', 'ARCHITECTURE_PLAN_v1.md'];

function markdownFiles() {
  const files = ROOT_DOCS.filter((f) => fs.existsSync(path.join(root, f)));
  const docs = path.join(root, 'docs');
  if (fs.existsSync(docs)) {
    for (const f of fs.readdirSync(docs, { recursive: true, encoding: 'utf8' })) {
      if (f.endsWith('.md')) files.push(path.join('docs', f));
    }
  }
  return files;
}

/** GitHub-style heading anchor: lowercase, drop punctuation, spaces to hyphens (accents and underscores stay). */
const slug = (heading) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[`*_~]/g, (c) => (c === '_' ? '_' : ''))
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');

function anchorsOf(file) {
  const anchors = new Set();
  const seen = new Map();
  let fenced = false;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (fenced) continue;
    const m = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const base = slug(m[1].replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'));
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    anchors.add(n === 0 ? base : `${base}-${n}`);
  }
  return anchors;
}

function loadScripts() {
  const pkg = (p) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(root, p), 'utf8')).scripts ?? {};
    } catch {
      return null;
    }
  };
  return {
    root: pkg('package.json'),
    '@planner/api': pkg('apps/api/package.json'),
    '@planner/web': pkg('apps/web/package.json'),
    '@planner/core': pkg('packages/core/package.json'),
  };
}

const findings = [];
const scripts = loadScripts();
const anchorCache = new Map();
const anchorsFor = (abs) => {
  if (!anchorCache.has(abs)) anchorCache.set(abs, anchorsOf(abs));
  return anchorCache.get(abs);
};

for (const rel of markdownFiles()) {
  const abs = path.join(root, rel);
  const lines = fs.readFileSync(abs, 'utf8').split('\n');
  let fenced = false;
  lines.forEach((line, i) => {
    const at = `${rel.replaceAll('\\', '/')}:${i + 1}`;
    const isFence = /^\s*```/.test(line);
    if (isFence) fenced = !fenced;

    // 3. npm scripts: inside code blocks and inline code.
    for (const m of line.matchAll(/npm run ([\w:.-]+)(?:\s+-w\s+(@planner\/\w+))?/g)) {
      const table = scripts[m[2] ?? 'root'];
      if (table && !(m[1] in table))
        findings.push([at, `npm script "${m[1]}" does not exist${m[2] ? ` in ${m[2]}` : ''}`]);
    }
    if (isFence || fenced) return;

    // 1. links.
    for (const m of line.matchAll(/(?<!!)\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const target = m[1];
      if (/^(https?:|mailto:|#)/.test(target)) {
        if (target.startsWith('#') && !anchorsFor(abs).has(target.slice(1)))
          findings.push([at, `anchor ${target} not found in this file`]);
        continue;
      }
      const [file, anchor] = target.split('#');
      const dest = path.resolve(path.dirname(abs), decodeURI(file));
      if (!fs.existsSync(dest)) {
        findings.push([at, `link to missing file: ${target}`]);
      } else if (anchor && dest.endsWith('.md') && !anchorsFor(dest).has(decodeURI(anchor))) {
        findings.push([at, `link to missing heading: ${target}`]);
      }
    }

    // 2. repository paths in `code`.
    for (const m of line.matchAll(
      /`((?:apps|packages|docs|e2e|scripts)\/[\w./-]+\.(?:ts|tsx|md|mjs|json|prisma|yml))`/g,
    )) {
      if (!fs.existsSync(path.join(root, m[1])))
        findings.push([at, `referenced file does not exist: ${m[1]}`]);
    }
  });
}

if (findings.length === 0) {
  say(`docs-check: ${markdownFiles().length} files, nothing found`);
} else {
  for (const [at, what] of findings) say(`${at}  ${what}`);
  say(`docs-check: ${findings.length} finding(s)`);
  process.exit(1);
}
