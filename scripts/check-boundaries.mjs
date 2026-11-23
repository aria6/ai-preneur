#!/usr/bin/env node
/**
 * Architectural boundary checker. Dependency-free on purpose: it must run
 * before `pnpm install` and in any CI step.
 *
 * Enforces the dependency rules documented in docs/architecture.md:
 *   - web      → shared only (no server-only packages, no Node built-ins)
 *   - api      → shared, database
 *   - database → (nothing internal)
 *   - shared   → zod only (runtime-agnostic)
 *   - no relative import may escape its own workspace package
 *   - no deep imports into another workspace package (`@ai-preneur/x/src/...`)
 *   - api modules import each other only through `modules/<name>/index.ts`
 *   - api modules never import app.ts, server.ts or routes/
 *   - api core/ and config/ never import modules/, routes/, middlewares/ or app/server
 *   - the workspace package graph is acyclic
 *
 * Usage: node scripts/check-boundaries.mjs
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCOPE = '@ai-preneur/';
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', 'migrations']);
const NODE_BUILTINS = new Set(builtinModules);

const SERVER_ONLY = [
  '@ai-preneur/api',
  '@ai-preneur/database',
  'express',
  'cors',
  'pg',
  'drizzle-orm',
  'drizzle-kit',
  'dotenv',
];

/** Per-package import policy. `allowExternal` (when set) is an allow-list. */
const PACKAGES = {
  'apps/web': {
    forbidden: SERVER_ONLY,
    forbidNodeBuiltins: true,
    allowedInternal: ['@ai-preneur/shared'],
  },
  'apps/api': {
    forbidden: ['@ai-preneur/web'],
    allowedInternal: ['@ai-preneur/shared', '@ai-preneur/database'],
  },
  'packages/database': { forbidden: [], allowedInternal: [] },
  'packages/shared': {
    forbidden: [],
    forbidNodeBuiltins: true,
    allowedInternal: [],
    allowExternal: ['zod'],
  },
};

const violations = [];
const report = (file, message) => violations.push(`${relative(ROOT, file)}: ${message}`);

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return SKIP_DIRS.has(entry) ? [] : walk(full);
    return SOURCE_FILE.test(entry) && !entry.endsWith('.d.ts') ? [full] : [];
  });
}

const IMPORT_PATTERN =
  /(?:^|[^.\w$])(?:import|export)\s+(?:type\s+)?(?:[\w$*{}\s,]+?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g;

function extractImports(source) {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  return [...code.matchAll(IMPORT_PATTERN)].map((m) => m[1] ?? m[2] ?? m[3]).filter(Boolean);
}

const packageName = (specifier) =>
  specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];

const matches = (specifier, target) => specifier === target || specifier.startsWith(`${target}/`);
const stripExt = (p) => p.replace(/\.(?:[cm]?[jt]sx?)$/, '');

/** Returns `<name>` when `absPath` is inside apps/api/src/modules/<name>/. */
function apiModuleOf(absPath) {
  const rel = relative(join(ROOT, 'apps/api/src/modules'), absPath);
  if (rel.startsWith('..') || rel === '') return null;
  const [name, ...rest] = rel.split(sep);
  return rest.length > 0 ? name : null;
}

function checkApiLayering(file, target) {
  const apiSrc = join(ROOT, 'apps/api/src');
  const relFile = relative(apiSrc, file).split(sep);
  const relTarget = stripExt(relative(apiSrc, target)).split(sep);
  const fileArea = relFile[0];
  const targetArea = relTarget[0];

  const fromModule = apiModuleOf(file);
  const toModule = apiModuleOf(target);

  if (fromModule && toModule && fromModule !== toModule) {
    const publicEntry = join(apiSrc, 'modules', toModule, 'index');
    if (stripExt(target) !== publicEntry && target !== join(apiSrc, 'modules', toModule)) {
      report(
        file,
        `module "${fromModule}" imports internal file of module "${toModule}" — use modules/${toModule}/index.ts`,
      );
    }
  }

  if (fromModule && ['app', 'server', 'routes'].includes(targetArea)) {
    report(
      file,
      `module "${fromModule}" must not import ${targetArea} (dependency direction is routes → modules)`,
    );
  }

  if (
    ['core', 'config'].includes(fileArea) &&
    ['modules', 'routes', 'middlewares', 'app', 'server'].includes(targetArea)
  ) {
    report(file, `${fileArea}/ is foundational and must not import ${targetArea}`);
  }
}

// --- 1. Source-level import rules -------------------------------------------------
for (const [pkgDir, policy] of Object.entries(PACKAGES)) {
  const pkgRoot = join(ROOT, pkgDir);
  for (const file of walk(join(pkgRoot, 'src'))) {
    for (const specifier of extractImports(readFileSync(file, 'utf8'))) {
      if (specifier.startsWith('.')) {
        const target = resolve(dirname(file), specifier);
        if (relative(pkgRoot, target).startsWith('..')) {
          report(
            file,
            `relative import "${specifier}" escapes ${pkgDir} — import the workspace package instead`,
          );
          continue;
        }
        if (pkgDir === 'apps/api') checkApiLayering(file, target);
        continue;
      }

      if (specifier.startsWith('node:') || NODE_BUILTINS.has(packageName(specifier))) {
        if (policy.forbidNodeBuiltins)
          report(file, `Node.js built-in "${specifier}" is not allowed in ${pkgDir}`);
        continue;
      }

      const forbidden = policy.forbidden.find((target) => matches(specifier, target));
      if (forbidden) {
        report(file, `"${specifier}" is not allowed in ${pkgDir} (server-only or wrong direction)`);
        continue;
      }

      if (specifier.startsWith(SCOPE)) {
        const name = packageName(specifier);
        if (specifier !== name)
          report(file, `deep import "${specifier}" — import from "${name}" only`);
        if (!policy.allowedInternal.includes(name))
          report(file, `${pkgDir} may not depend on "${name}"`);
        continue;
      }

      if (policy.allowExternal && !policy.allowExternal.includes(packageName(specifier))) {
        report(
          file,
          `"${specifier}" is not allowed in ${pkgDir}; allowed: ${policy.allowExternal.join(', ')}`,
        );
      }
    }
  }
}

// --- 2. package.json dependency rules + cycle detection ----------------------------
const graph = new Map();
for (const [pkgDir, policy] of Object.entries(PACKAGES)) {
  const manifestPath = join(ROOT, pkgDir, 'package.json');
  if (!existsSync(manifestPath)) {
    report(manifestPath, 'missing package.json');
    continue;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const deps = Object.keys({
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.peerDependencies,
  });
  const internal = deps.filter((d) => d.startsWith(SCOPE));
  graph.set(manifest.name, internal);

  for (const dep of internal) {
    if (!policy.allowedInternal.includes(dep))
      report(manifestPath, `${manifest.name} must not depend on ${dep}`);
  }
  for (const dep of deps) {
    if (policy.forbidden.includes(dep))
      report(manifestPath, `${manifest.name} must not depend on server-only "${dep}"`);
    if (
      policy.allowExternal &&
      !dep.startsWith(SCOPE) &&
      manifest.dependencies?.[dep] &&
      !policy.allowExternal.includes(dep)
    ) {
      report(manifestPath, `${manifest.name} runtime dependency "${dep}" not in allow-list`);
    }
  }
}

const visiting = new Set();
const done = new Set();
function visit(node, path) {
  if (done.has(node)) return;
  if (visiting.has(node)) {
    violations.push(`package cycle: ${[...path, node].join(' → ')}`);
    return;
  }
  visiting.add(node);
  for (const dep of graph.get(node) ?? []) visit(dep, [...path, node]);
  visiting.delete(node);
  done.add(node);
}
for (const node of graph.keys()) visit(node, []);

// --- Result ------------------------------------------------------------------------
if (violations.length > 0) {
  console.error(`✖ ${violations.length} architectural boundary violation(s):\n`);
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}
console.log(
  '✔ Architectural boundaries respected (packages, imports, api module isolation, no cycles).',
);
