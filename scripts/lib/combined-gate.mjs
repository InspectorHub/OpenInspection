/**
 * Runner shared by the combined gate scripts (check-tree-hygiene.mjs and its
 * siblings).
 *
 * A combined gate is several checks that read the same kind of input, run in one
 * process behind one registry row. What must survive the merge is everything a
 * reader of a failing run depends on, so the contract here is narrow:
 *
 *   - Every check still prints its OWN lines, unchanged, including the
 *     "checked N / found M" numbers it always printed. This runner adds a
 *     header and a verdict per check around them; it never rewrites them.
 *   - Every check runs even after another failed, so one run shows every
 *     violation. The exit code is 1 if any selected check failed.
 *   - `--only a,b` selects checks by name. An unknown name EXITS 2 and so does
 *     a selection of zero: a typo that ran nothing would read as a clean run,
 *     which is the failure shape this repository keeps meeting.
 *   - A check signals failure the way a standalone script does, by calling
 *     process.exit(non-zero). That is trapped for the duration of the check and
 *     turned into a verdict, so a check needs no knowledge of being combined.
 *
 * Both counts print on every run, pass or fail: selected of total, passed and
 * failed. A summary that spoke only when something failed could not be checked
 * on the day it was quiet.
 */

const EXIT = Symbol('combined-gate-exit');

/**
 * Run `fn` with process.exit trapped and stdout/stderr captured.
 * Returns { code, chunks } where chunks keep which stream each piece came from.
 */
export async function captureCheck(fn) {
    const chunks = [];
    const tag = (stream) => (chunk) => {
        chunks.push({ stream, text: typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8') });
        return true;
    };
    const realExit = process.exit;
    const realOut = process.stdout.write.bind(process.stdout);
    const realErr = process.stderr.write.bind(process.stderr);
    let code = 0;
    process.exit = (c = 0) => {
        code = c;
        throw EXIT;
    };
    process.stdout.write = tag('out');
    process.stderr.write = tag('err');
    try {
        await fn();
    } catch (err) {
        if (err !== EXIT) {
            code = code || 1;
            chunks.push({ stream: 'err', text: `${err?.stack ?? String(err)}\n` });
        }
    } finally {
        process.exit = realExit;
        process.stdout.write = realOut;
        process.stderr.write = realErr;
    }
    return { code, chunks };
}

/**
 * @param {object} opts
 * @param {string} opts.group   name printed in the headers, e.g. "tree-hygiene"
 * @param {{ name: string, run: () => Promise<void> | void }[]} opts.checks
 * @param {string[]} [opts.argv] arguments after the script name
 * @returns {Promise<number>} the exit code
 */
export async function runCombined({ group, checks, argv = process.argv.slice(2) }) {
    const names = checks.map((c) => c.name);
    const at = argv.indexOf('--only');
    let selected = checks;
    if (at !== -1) {
        const wanted = (argv[at + 1] ?? '').split(',').filter(Boolean);
        const unknown = wanted.filter((n) => !names.includes(n));
        if (unknown.length || wanted.length === 0) {
            console.error(
                `${group}: unknown or empty --only "${argv[at + 1] ?? ''}" (checks: ${names.join(', ')}). ` +
                'Selecting nothing is a failure, not a clean run.',
            );
            return 2;
        }
        selected = checks.filter((c) => wanted.includes(c.name));
    }

    let failed = 0;
    for (const check of selected) {
        console.log(`── ${group} › ${check.name} ──`);
        const { code, chunks } = await captureCheck(check.run);
        for (const { stream, text } of chunks) (stream === 'err' ? process.stderr : process.stdout).write(text);
        const ok = code === 0;
        if (!ok) failed += 1;
        console.log(`── ${group} › ${check.name}: ${ok ? 'PASS' : `FAIL (exit ${code})`}`);
    }
    const line = `${group}: ${selected.length} of ${checks.length} check(s) run · ` +
        `${selected.length - failed} passed · ${failed} failed`;
    if (failed) console.error(line);
    else console.log(line);
    return failed ? 1 : 0;
}

/**
 * Import a check that is a plain top-level script (it does its work when
 * imported, as every standalone gate here does) with `args` as its argv tail.
 * A module is evaluated once per process, so each such check runs once.
 */
export async function importAsScript(fileUrl, args = []) {
    const tail = process.argv.slice(2);
    process.argv.splice(2, process.argv.length - 2, ...args);
    try {
        await import(fileUrl);
    } finally {
        process.argv.splice(2, process.argv.length - 2, ...tail);
    }
}
