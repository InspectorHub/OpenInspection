#!/usr/bin/env node
/**
 * preflight-self-host.mjs: check a freshly deployed instance before any data goes in.
 *
 *   node scripts/preflight-self-host.mjs --url https://inspect.example.com [options]
 *
 *   --url <https://host>   the instance to check (required)
 *   --config <file>        wrangler config to read (default: WRANGLER_CONFIG, then
 *                          wrangler.local.jsonc, then wrangler.jsonc)
 *   --json                 print one JSON document instead of text
 *   --only <id,id>         run just these checks
 *   --min-version <x.y.z>  fail when /status reports an older version
 *   --skip-wrangler        do not call wrangler; the checks that need it are reported
 *                          as "need attention", never as passes
 *
 * Needs only Node. The checks that read the account (secret NAMES, an R2 write probe
 * that deletes itself) run `npx wrangler`, so they use whatever login wrangler has.
 * Values of secrets are never requested and never printed.
 *
 * Exit codes: 0 no check failed, 1 at least one check failed (or none ran), 2 usage.
 * A run that evaluated zero checks is a failure, never a pass.
 */
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJsonc, bindingChecks, cronCheck, BINDING_IDS } from './lib/preflight-config.mjs';
import { remoteChecks, safeCode, PreflightError } from './lib/preflight-remote.mjs';

export { parseJsonc };

const configCheck = {
  id: 'config',
  needs: 'config',
  run: () => ({ status: 'pass', message: 'the wrangler config was read' }),
};

export function allChecks() {
  const [status, baseUrl, ...rest] = remoteChecks();
  return [status, baseUrl, configCheck, ...bindingChecks(), cronCheck, ...rest];
}

export const CHECK_IDS = ['status', 'base-url', 'config', ...BINDING_IDS, 'cron', 'jwt-keyring', 'photos-write', 'turnstile', 'email'];

export const QUESTIONS = [
  'Is the Cloudflare account on the Workers paid plan? The app cannot see its plan or CPU limit from inside; the free plan stops long jobs with error 1102.',
  'Is the D1 free-tier write quota (100,000 rows per day) enough for what you plan to load? The app cannot read it.',
];

function defaultConfigPath() {
  return process.env.WRANGLER_CONFIG || (existsSync('wrangler.local.jsonc') ? 'wrangler.local.jsonc' : 'wrangler.jsonc');
}

const SAFE_SHELL_ARG = /^[\w.\\/:=~-]+$/;
/** Characters a config path may contain: no spaces, no shell metacharacters (~ allows 8.3 short names). */
const SAFE_CONFIG_PATH = /^[\w.\\/:~][\w.\\/:~-]*$/;

/** The wrangler entry script inside this checkout's node_modules, or null. */
function findWranglerBin() {
  const bin = join(process.cwd(), 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  return existsSync(bin) ? bin : null;
}

/**
 * How to start wrangler. On Windows with the wrangler script found, run it with node and an
 * argument array (no shell, so nothing is re-parsed). Without it, fall back to `npx.cmd` through
 * a shell, which re-parses the whole line, so every argument must be plain characters or the
 * call is refused. Elsewhere there is no shell.
 */
export function buildInvocation(args, configPath, env = { platform: process.platform, wranglerBin: findWranglerBin(), execPath: process.execPath }) {
  const full = [...args, '-c', configPath];
  if (env.platform !== 'win32') return { cmd: 'npx', args: ['wrangler', ...full], shell: false };
  if (env.wranglerBin) return { cmd: env.execPath, args: [env.wranglerBin, ...full], shell: false };
  if (!full.every((a) => SAFE_SHELL_ARG.test(a))) {
    return { error: 'an argument contains a space or shell character and wrangler could not be started without a shell' };
  }
  return { cmd: 'npx.cmd', args: ['wrangler', ...full], shell: true };
}

/** The runner the checks use: `run(args, { cwd })`. `env` and `spawn` are injectable for tests. */
export function makeRunner(configPath, env, spawn = spawnSync) {
  return async (args, opts = {}) => {
    // A changed working directory must not change which config is read.
    const cfg = opts.cwd ? resolve(configPath) : configPath;
    const inv = buildInvocation(args, cfg, env);
    if (inv.error) return { status: 1, stdout: '', stderr: '', code: 'UNSAFE_ARG' };
    const r = spawn(inv.cmd, inv.args, { encoding: 'utf8', shell: inv.shell, timeout: 90_000, cwd: opts.cwd });
    return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '', code: r.error?.code };
  };
}

export function summarize(results) {
  const counts = { pass: 0, attention: 0, fail: 0, total: results.length };
  for (const r of results) counts[r.status] += 1;
  const exitCode = counts.total === 0 || counts.fail > 0 ? 1 : 0;
  return { counts, exitCode };
}

export async function runPreflight(opts) {
  const configPath = opts.configPath ?? defaultConfigPath();
  const ctx = {
    url: opts.url,
    fetchImpl: opts.fetchImpl ?? fetch,
    minVersion: opts.minVersion,
    skipWrangler: Boolean(opts.skipWrangler),
    tmpDir: opts.tmpDir ?? tmpdir(),
    run: opts.run ?? makeRunner(configPath),
    cfg: null,
  };
  let cfgError = null;
  if (!SAFE_CONFIG_PATH.test(configPath)) {
    cfgError = 'the config path has characters this script does not accept (letters, digits, . _ - / \\ : only, no spaces)';
  } else {
    let text = null;
    try {
      text = readFileSync(configPath, 'utf8');
    } catch (e) {
      cfgError = `the wrangler config file could not be read${safeCode(e?.code) ? ` (${safeCode(e?.code)})` : ''}`;
    }
    if (text !== null) {
      try {
        ctx.cfg = parseJsonc(text);
        if (typeof ctx.cfg !== 'object' || ctx.cfg === null || Array.isArray(ctx.cfg)) throw new Error('not an object');
      } catch (e) {
        const where = e?.line ? ` near line ${e.line}, column ${e.column}` : '';
        cfgError = `the wrangler config could not be read as JSONC${where}`;
      }
    }
  }
  let checks = opts.checks ?? allChecks();
  if (opts.only) checks = checks.filter((c) => opts.only.includes(c.id));
  const results = [];
  for (const c of checks) {
    let r;
    try {
      if (c.needs === 'config' && cfgError) {
        r = { status: 'fail', message: c.id === 'config' ? cfgError : 'cannot run: the wrangler config could not be read', fix: 'Check the config path or pass --config.' };
      } else {
        r = await c.run(ctx);
      }
    } catch (e) {
      r = { status: 'fail', message: e instanceof PreflightError ? e.message : 'the check crashed unexpectedly' };
    }
    results.push({ id: c.id, ...r });
  }
  const { counts, exitCode } = summarize(results);
  return { checks: results, counts, questions: QUESTIONS, exitCode };
}

const USAGE = 'usage: node scripts/preflight-self-host.mjs --url <https://host> [--config <file>] [--json] [--only <id,id>] [--min-version <x.y.z>] [--skip-wrangler]';

export function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--url') o.url = val();
    else if (a === '--config') o.configPath = val();
    else if (a === '--min-version') o.minVersion = val();
    else if (a === '--only') o.only = val().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--json') o.json = true;
    else if (a === '--skip-wrangler') o.skipWrangler = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!o.url) throw new Error('--url is required');
  let parsed;
  try {
    parsed = new URL(o.url);
  } catch {
    throw new Error('--url is not a valid URL');
  }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error('--url must be http or https');
  if (o.minVersion !== undefined && !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(o.minVersion)) throw new Error('--min-version must look like 1.2.3 or 1.2.3-rc.1');
  if (o.only) {
    const bad = o.only.filter((id) => !CHECK_IDS.includes(id));
    if (bad.length || o.only.length === 0) throw new Error(`unknown check id(s): ${bad.join(', ') || '(none given)'}; known: ${CHECK_IDS.join(', ')}`);
  }
  return o;
}

const LABEL = { pass: 'PASS', attention: 'WARN', fail: 'FAIL' };

export async function main(argv, io = { stdout: (s) => process.stdout.write(s), stderr: (s) => process.stderr.write(s) }, deps = {}) {
  let o;
  try {
    o = parseArgs(argv);
  } catch (e) {
    io.stderr(`${e.message}\n${USAGE}\n`);
    return 2;
  }
  const report = await runPreflight({ ...o, ...deps });
  if (o.json) {
    io.stdout(`${JSON.stringify(report, null, 2)}\n`);
    return report.exitCode;
  }
  const lines = [`Preflight for ${new URL(o.url).origin}`, ''];
  for (const c of report.checks) {
    lines.push(`${LABEL[c.status]}  ${c.id}: ${c.message}`);
    if (c.fix && c.status !== 'pass') lines.push(`        fix: ${c.fix}`);
  }
  const { pass, attention, fail, total } = report.counts;
  lines.push('', `${pass} passed, ${attention} need attention, ${fail} failed (${total} checks)`);
  if (total === 0) lines.push('No check ran; that counts as a failure.');
  lines.push('', 'Questions only you can answer:', ...report.questions.map((q) => `  - ${q}`), '');
  io.stdout(lines.join('\n'));
  return report.exitCode;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
