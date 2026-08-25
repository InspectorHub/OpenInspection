#!/usr/bin/env node
/**
 * Run a command, stream its output to the console AND to a durable log file.
 *
 * Usage:  node scripts/run-logged.mjs <label> -- <bin> [args...]
 * Example: node scripts/run-logged.mjs unit -- vitest run --config vitest.api.config.ts
 *
 * ## Why this exists
 *
 * On 2026-08-24 a full unit run reported one failure whose message was the
 * "This error originated in <file> ... while it was running" shape — something
 * thrown during the run rather than an assertion. By the time it was read, only
 * the tail of the output survived, so the error text was gone. The spec passed
 * in isolation, passed again on the next full run, and that run failed four
 * DIFFERENT files instead. A real intermittent failure, and nothing left to
 * diagnose it from.
 *
 * A vitest JSON reporter was tried first and MEASURED INSUFFICIENT: a probe that
 * threw from a background promise after its test body returned produced that
 * console wording plus `Errors 1 error`, while the JSON report contained ZERO
 * occurrences of the thrown message. Unhandled errors reach the console reporter
 * and not the file one. So the only thing demonstrated to contain that
 * information is stdout, which is what this captures.
 *
 * ## Two properties this file exists to guarantee
 *
 * 1. **The exit code is the child's.** The same day, a backgrounded suite
 *    reported `exited with code 0` while vitest's own summary said `1 failed`.
 *    Read only the exit code and a red run enters the record as green. This
 *    wrapper forwards the child's code, and turns death-by-signal into a
 *    non-zero code rather than a silent 0.
 * 2. **Output is streamed, not buffered.** A long suite that prints nothing
 *    until it finishes is indistinguishable from a hung one, and someone will
 *    kill it.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createWriteStream, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOG_DIR = join(ROOT, '.runlogs');
/** Keep the newest N logs per label. An intermittent failure is often several
 *  runs back, so one slot is not enough; unbounded is not a log, it is a leak. */
const KEEP_PER_LABEL = 10;

const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
if (sep < 1 || sep === argv.length - 1) {
    console.error('usage: node scripts/run-logged.mjs <label> -- <bin> [args...]');
    process.exit(2);
}
const label = argv.slice(0, sep).join('-').replace(/[^a-z0-9._-]/gi, '_');
const [bin, ...args] = argv.slice(sep + 1);

/**
 * Resolve a dependency's own JS entry point so we can spawn it with `node`
 * directly. Deliberately NOT `shell: true`: on Windows a shell-spawned shim
 * swallows arguments containing spaces, and this project has already lost time
 * to exactly that. Falls back to the bare name only when resolution fails,
 * which means the caller passed something that is not a dependency.
 */
function resolveBin(name) {
    const req = createRequire(import.meta.url);
    try {
        const pkgPath = req.resolve(`${name}/package.json`);
        const pkg = req(`${name}/package.json`);
        const rel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.[name];
        if (rel) return { cmd: process.execPath, argv: [join(dirname(pkgPath), rel), ...args] };
    } catch { /* not a resolvable dependency — fall through */ }
    return null;
}

function pruneOldLogs() {
    let entries;
    try {
        entries = readdirSync(LOG_DIR)
            .filter((f) => f.startsWith(`${label}-`) && f.endsWith('.log'))
            .map((f) => ({ f, t: statSync(join(LOG_DIR, f)).mtimeMs }))
            .sort((a, b) => b.t - a.t);
    } catch { return; }
    for (const { f } of entries.slice(KEEP_PER_LABEL - 1)) {
        try { rmSync(join(LOG_DIR, f)); } catch { /* another run may have taken it */ }
    }
}

mkdirSync(LOG_DIR, { recursive: true });
pruneOldLogs();

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const logPath = join(LOG_DIR, `${label}-${stamp}.log`);
const log = createWriteStream(logPath, { flags: 'a' });

const header = `# ${label} — ${args.length ? `${bin} ${args.join(' ')}` : bin}\n# started ${new Date().toISOString()}\n\n`;
log.write(header);

const resolved = resolveBin(bin);
const child = resolved
    ? spawn(resolved.cmd, resolved.argv, { cwd: ROOT, env: process.env })
    : spawn(bin, args, { cwd: ROOT, env: process.env, shell: process.platform === 'win32' });

for (const [stream, sink] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
    stream.on('data', (chunk) => { sink.write(chunk); log.write(chunk); });
}

/** Written last so the file always ends with the verdict, whatever scrolled by. */
function finish(code, signal) {
    const verdict = signal
        ? `killed by signal ${signal}`
        : `exit code ${code}`;
    log.write(`\n# finished ${new Date().toISOString()} — ${verdict}\n`);
    log.end(() => {
        process.stdout.write(`\nrun-logged: ${label} → ${logPath} (${verdict})\n`);
        // A signal is a failure. Reporting 0 here would recreate the exact bug
        // this file documents at the top.
        process.exit(signal ? 1 : (code ?? 1));
    });
}

child.on('error', (err) => {
    const msg = `\n# run-logged could not start the command: ${err.message}\n`;
    process.stderr.write(msg);
    log.write(msg);
    finish(127, null);
});
child.on('close', (code, signal) => finish(code, signal));
