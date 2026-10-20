#!/usr/bin/env node
/**
 * Optional native type-check: `npm run type-check:native`.
 *
 * Runs the same four programs as `npm run type-check` (api, app, tests, e2e)
 * through `tsgo`, the native TypeScript compiler from `@typescript/native-preview`.
 *
 * What this is NOT:
 *   - Not the authority. CI and the pre-commit hook keep using the real `tsc`.
 *     A green run here does not replace them, and a red run here is a reason to
 *     look, not a verdict.
 *   - Not stable. The package is a preview, so its version is pinned exactly in
 *     package.json. Bump it deliberately and re-run this script on a known-good
 *     tree before trusting the result.
 *   - Not always faster. Its value is removing the cold-start cliff: a cold run
 *     takes roughly a third of cold `tsc` and uses less memory. After a change
 *     to server declarations the incremental rebuild is slower than a warm
 *     `tsc -b`.
 *
 * Why one checker (`--checkers 1`):
 *   tsgo defaults to 4 parallel checkers. Each holds its own copy of the type
 *   cache, so memory roughly multiplies; on a 16 GB machine the default drove
 *   free memory down to a few MB. The flag is fixed in the step list below and
 *   covered by a test. Do not raise it.
 *
 * Why a separate output directory (`.types-tsgo/`):
 *   The tsc projects write declarations and build-info into `.types/` and
 *   `.tsbuildinfo.*`. Two compilers sharing one build-info file overwrite each
 *   other and force both back to a cold build. The native configs
 *   (tsconfig.native-*.json) redirect everything into `.types-tsgo/`, and this
 *   script never writes to `.types/`.
 *
 * Serial rule:
 *   Steps run one after another, and this script must not run alongside another
 *   type-check, eslint or a build. Peak memory of a cold run is about 7.5 GB.
 *   The api step must come first: the other programs consume its declarations.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Fixed on purpose: see "Why one checker" above. */
export const CHECKERS_FLAG = ['--checkers', '1'];

/** The directory every native output must live in. */
export const NATIVE_OUT_DIR = '.types-tsgo';

/** Ordered steps. api first, because app, tests and e2e reference it. */
export function nativeSteps() {
  return ['api', 'app', 'tests', 'e2e'].map((name) => ({
    name,
    config: `tsconfig.native-${name}.json`,
    args: ['-b', `tsconfig.native-${name}.json`, ...CHECKERS_FLAG],
  }));
}

function stripTrailingSlash(p) {
  return p.replace(/^\.\//, '').replace(/\/+$/, '');
}

/**
 * Validates a parsed native tsconfig. Returns a list of problems (empty = ok).
 * `expected.extends` is the original config it must extend; `expected.references`
 * is true for the programs that consume the API declarations.
 */
export function validateNativeConfig(config, expected) {
  const problems = [];
  if (config.extends !== expected.extends) {
    problems.push(`extends must be ${expected.extends}, got ${String(config.extends)}`);
  }
  const opts = config.compilerOptions ?? {};
  const inside = (p) => stripTrailingSlash(p).startsWith(`${NATIVE_OUT_DIR}/`) || stripTrailingSlash(p) === NATIVE_OUT_DIR;
  if (typeof opts.tsBuildInfoFile !== 'string') {
    problems.push('tsBuildInfoFile is required');
  } else if (!inside(opts.tsBuildInfoFile)) {
    problems.push(`tsBuildInfoFile must be inside ${NATIVE_OUT_DIR}/, got ${opts.tsBuildInfoFile}`);
  }
  if (opts.outDir !== undefined && !inside(opts.outDir)) {
    problems.push(`outDir must be inside ${NATIVE_OUT_DIR}/, got ${opts.outDir}`);
  }
  const refs = (config.references ?? []).map((r) => stripTrailingSlash(r.path));
  if (expected.references) {
    if (refs.length !== 1 || refs[0] !== 'tsconfig.native-api.json') {
      problems.push(`references must be exactly [tsconfig.native-api.json], got [${refs.join(', ')}]`);
    }
  } else if (refs.length > 0) {
    problems.push(`references must be empty, got [${refs.join(', ')}]`);
  }
  return problems;
}

function fmtSeconds(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

function resolveTsgoLauncher(root) {
  try {
    const require = createRequire(join(root, 'package.json'));
    const pkgJson = require.resolve('@typescript/native-preview/package.json');
    return join(dirname(pkgJson), 'bin', 'tsgo');
  } catch {
    return null;
  }
}

export function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const launcher = resolveTsgoLauncher(root);
  if (!launcher) {
    console.error('type-check:native: @typescript/native-preview is not installed. Run `npm install` first.');
    return 1;
  }
  const started = Date.now();
  for (const step of nativeSteps()) {
    const t0 = Date.now();
    console.log(`\n[native] ${step.name}: tsgo ${step.args.join(' ')}`);
    // The launcher is a plain Node script, so running it through this Node
    // binary works on every platform without a .cmd shim.
    const res = spawnSync(process.execPath, [launcher, ...step.args], { cwd: root, stdio: 'inherit' });
    const elapsed = fmtSeconds(Date.now() - t0);
    const code = res.status ?? 1;
    if (code !== 0) {
      console.error(`[native] ${step.name}: FAILED with exit code ${code} after ${elapsed}`);
      return code;
    }
    console.log(`[native] ${step.name}: ok in ${elapsed}`);
  }
  console.log(`\n[native] all steps passed in ${fmtSeconds(Date.now() - started)}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
