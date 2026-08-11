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
    { key: 'contrast', label: 'Small-text WCAG AA contrast', script: 'check-contrast.mjs', fix: 'npm run lint:contrast' },
    { key: 'svg', label: 'SVG dimensions', script: 'check-svg-dimensions.mjs', fix: 'npm run lint:svg' },
    { key: 'migrefs', label: 'Migration-reference hygiene', script: 'check-migration-refs.mjs', fix: 'npm run lint:migrefs' },
    { key: 'filesize', label: 'Large-file ratchet', script: 'check-file-size.mjs', fix: 'npm run lint:filesize' },
    { key: 'tz', label: 'Calendar timezone-safety', script: 'check-tz-safety.mjs', fix: 'npm run lint:tz' },
    { key: 'idempotency', label: 'Mutating-route retry safety', script: 'check-idempotency-coverage.mjs', fix: 'npm run lint:idempotency' },
    // Pre-commit and not CI because a collision is created at exactly one moment
    // -- when a file is added or renamed -- and this is the rung that sees that
    // moment. It is also the rung where the fix is free: renaming a file nobody
    // has pulled yet costs nothing, renaming one after it lands costs everyone a
    // merge. An fs walk of ~2765 files, no parsing; among the cheapest here.
    { key: 'extcollide', label: 'Extension collisions (files invisible to tsc)', script: 'check-extension-collisions.mjs', fix: 'npm run lint:ext-collisions' },
    // Belongs at pre-commit rather than CI: what it catches is a CAPABILITY
    // being added -- a money column, a money field on the inspection record, a
    // money input on a new screen. By the time CI sees one it is written and
    // argued for. ~0.1s inside this shared process.
    { key: 'price', label: 'Price capability inventory', script: 'check-price-capability.mjs', fix: 'npm run lint:price-capability' },
    // Here for the same reason as the price gate: what it catches is a
    // CAPABILITY arriving -- a beacon, an analytics global, a pixel. By the time
    // CI sees one it is written and argued for, and "we already ship no
    // tracking" is much easier to hold than "please remove the tracking you
    // added". Costs ~0.8s (it reads ~976 client files), against ~0.1s for the
    // price gate -- the most expensive entry in this set, and still small next
    // to the eslint and tsc steps around it.
    { key: 'zerotrack', label: 'Zero client-side tracking', script: 'check-zero-tracking.mjs', fix: 'npm run lint:zero-tracking' },
    // Third entry with the same justification, and the clearest case of it: what
    // it catches is an AI capability arriving with nobody having said what kind
    // of statement it produces, or reaching a model without going through the
    // one method that asks. The compiler already refuses an unclassified prompt;
    // this covers the second route to a provider, which no type can see. 0.4s,
    // between the price gate and the tracking gate.
    { key: 'aiclass', label: 'AI output classification', script: 'check-ai-classification.mjs', fix: 'npm run lint:ai-classification' },
    // Two file reads and a set comparison -- the cheapest gate in this list by an
    // order of magnitude, and the one whose failure is most easily argued away
    // later. It belongs at pre-commit for the same reason the price and tracking
    // gates do: what it catches is a spec being written OFF the type-check, and
    // the moment to question that is while the line is being typed.
    { key: 'teststsconfig', label: 'tests tsconfig exclude ratchet', script: 'check-tests-tsconfig.mjs', fix: 'npm run lint:tests-tsconfig' },
    // Pre-commit for the same reason as the price, tracking and AI gates: what it
    // catches is a raw `fetcher.submit` ARRIVING -- an unguarded mutation with no
    // idempotency key and no pending affordance. That is cheapest to argue about
    // while the line is being typed, and by the time CI sees one it is written.
    // An fs walk of ~680 client files with two regexes; comparable to the
    // tracking gate.
    { key: 'submitguard', label: 'Client submit-guard coverage', script: 'check-submit-guard.mjs', fix: 'npm run lint:submit-guard' },
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
