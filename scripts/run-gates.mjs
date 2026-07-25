#!/usr/bin/env node
/**
 * Run the repo's fast conformance gates in ONE node process.
 *
 * Each gate is a standalone script that reads files and exits non-zero on a
 * violation. Individually they cost 0.7-1.3s, of which almost all is node
 * starting up and resolving its own module graph -- the checks themselves scan a
 * few hundred files in milliseconds. Spawning five of them serially from the
 * pre-commit hook paid that startup five times.
 *
 * They run here as imports instead. A gate signals failure by calling
 * process.exit, which inside one shared process would take the whole run down
 * before the remaining gates ran, so exit is trapped for the duration of each
 * import and turned into a thrown sentinel. Output is buffered and printed only
 * for gates that fail, so a green run stays quiet and a red one shows exactly
 * the violations that matter.
 *
 * jscpd is a third-party CLI, not one of our scripts, so it stays a child
 * process -- but spawned directly rather than through `npm run`, which was
 * costing an extra shell.
 *
 * Usage: node scripts/run-gates.mjs [--only ds,svg,...]
 * Exit code is 1 if any gate failed, and every gate runs regardless of the
 * others -- one commit should surface every violation, not just the first.
 */
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

/** Gates that are plain node scripts in this repo. */
const SCRIPT_GATES = [
    { key: 'ds', label: 'DS token conformance', script: 'check-ds-tokens.mjs', fix: 'npm run lint:ds' },
    { key: 'svg', label: 'SVG dimensions', script: 'check-svg-dimensions.mjs', fix: 'npm run lint:svg' },
    { key: 'migrefs', label: 'Migration-reference hygiene', script: 'check-migration-refs.mjs', fix: 'npm run lint:migrefs' },
    { key: 'filesize', label: 'Large-file ratchet', script: 'check-file-size.mjs', fix: 'npm run lint:filesize' },
    { key: 'tz', label: 'Calendar timezone-safety', script: 'check-tz-safety.mjs', fix: 'npm run lint:tz' },
];

const DUP_GATE = { key: 'dup', label: 'Duplicate-code ceiling', fix: 'npm run lint:dup' };

const onlyArg = process.argv.indexOf('--only');
const only = onlyArg === -1 ? null : new Set((process.argv[onlyArg + 1] ?? '').split(',').filter(Boolean));
const wanted = (key) => !only || only.has(key);

const EXIT_SENTINEL = Symbol('gate-exit');

/**
 * Import a gate script with process.exit trapped and its output captured.
 * Returns { ok, output }.
 */
async function runScriptGate(gate) {
    const chunks = [];
    const capture = (chunk) => {
        chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
        return true;
    };

    const realExit = process.exit;
    const realOut = process.stdout.write.bind(process.stdout);
    const realErr = process.stderr.write.bind(process.stderr);
    const realArgv1 = process.argv[1];
    const scriptPath = path.join(ROOT, 'scripts', gate.script);

    let exitCode = 0;
    process.exit = (code = 0) => {
        exitCode = code;
        throw EXIT_SENTINEL;
    };
    process.stdout.write = capture;
    process.stderr.write = capture;
    // check-tz-safety.mjs only runs when invoked as the entry script; make its
    // `import.meta.url === process.argv[1]` guard see itself as the entry point.
    process.argv[1] = scriptPath;

    let thrown = null;
    try {
        await import(pathToFileURL(scriptPath).href);
    } catch (err) {
        if (err !== EXIT_SENTINEL) thrown = err;
    } finally {
        process.exit = realExit;
        process.stdout.write = realOut;
        process.stderr.write = realErr;
        process.argv[1] = realArgv1;
    }

    if (thrown) {
        return { ok: false, output: `${chunks.join('')}\n${thrown.stack ?? String(thrown)}` };
    }
    return { ok: exitCode === 0, output: chunks.join('') };
}

function runDupGate() {
    const res = spawnSync(
        process.execPath,
        [path.join(ROOT, 'node_modules', 'jscpd', 'run-jscpd.js'), 'server', 'app', 'packages'],
        { cwd: ROOT, encoding: 'utf8' },
    );
    return { ok: res.status === 0, output: `${res.stdout ?? ''}${res.stderr ?? ''}` };
}

const results = [];
for (const gate of SCRIPT_GATES) {
    if (!wanted(gate.key)) continue;
    results.push([gate, await runScriptGate(gate)]);
}
if (wanted(DUP_GATE.key)) {
    results.push([DUP_GATE, runDupGate()]);
}

let failed = false;
for (const [gate, result] of results) {
    if (result.ok) {
        process.stdout.write(`  ✓  ${gate.label} passed\n`);
    } else {
        failed = true;
        process.stdout.write(`  ✗  ${gate.label} failed  →  ${gate.fix}\n`);
        const detail = result.output.trim();
        if (detail) process.stdout.write(`${detail.replace(/^/gm, '     ')}\n`);
    }
}

process.exit(failed ? 1 : 0);
