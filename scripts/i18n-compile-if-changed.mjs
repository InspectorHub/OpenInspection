#!/usr/bin/env node
/**
 * Run the paraglide compiler only when its inputs actually changed.
 *
 * `npm run i18n:compile` takes ~66s on this project (4000+ message keys) and is
 * run by the pre-commit hook and by four CI jobs. It is a pure function of
 * `messages/**` plus `project.inlang/`, so most of those runs recompute an
 * identical `app/paraglide/` from identical inputs.
 *
 * The guard is a content hash rather than mtimes, deliberately: a fresh
 * checkout, a `git stash pop`, or a branch switch all rewrite files whose
 * content is unchanged, and an mtime check would rebuild for every one of them.
 *
 * It is also conservative in one direction only. Anything it cannot be sure
 * about — no stamp, unreadable stamp, missing output directory, hash mismatch —
 * compiles. Skipping happens solely when the stamp matches AND the output
 * exists, because a stale `app/paraglide/` is a wrong build, while a redundant
 * compile only costs a minute.
 *
 * Pass --force to compile regardless (useful when debugging the compiler).
 */
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT_DIR = 'app/paraglide';
// The stamp lives INSIDE the output directory on purpose: anything that caches
// or restores `app/paraglide` (CI does) carries the record of which inputs
// produced it, so a restored directory is trusted only for the exact inputs
// that built it. Keeping the stamp elsewhere would make every fresh checkout
// recompile even with the output already in hand.
const STAMP = 'app/paraglide/.inputs-hash';
const INPUT_DIRS = ['messages', 'project.inlang'];
const force = process.argv.includes('--force');

/** Every input file, sorted, so the hash does not depend on directory order. */
function walk(dir, acc = []) {
    if (!existsSync(dir)) return acc;
    for (const name of readdirSync(dir).sort()) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, acc);
        else acc.push(p);
    }
    return acc;
}

function inputHash() {
    const h = createHash('sha256');
    for (const f of INPUT_DIRS.flatMap((d) => walk(d))) {
        h.update(f);
        h.update(readFileSync(f));
    }
    return h.digest('hex');
}

function compile() {
    execSync('npm run i18n:compile', { stdio: 'inherit' });
}

const hash = inputHash();

if (force) {
    console.log('[i18n] --force: compiling.');
    compile();
} else if (!existsSync(OUT_DIR)) {
    console.log(`[i18n] ${OUT_DIR} missing — compiling.`);
    compile();
} else {
    let previous = null;
    try {
        previous = readFileSync(STAMP, 'utf8').trim();
    } catch {
        // No stamp yet, or unreadable — fall through and compile.
    }
    if (previous === hash) {
        console.log('[i18n] inputs unchanged — skipped.');
        process.exit(0);
    }
    console.log(previous ? '[i18n] inputs changed — compiling.' : '[i18n] no stamp — compiling.');
    compile();
}

// Stamp only AFTER a compile that did not throw: recording the hash for a failed
// run would make the next one skip and leave app/paraglide half-written.
try {
    execSync('node -e "require(\'node:fs\').mkdirSync(\'node_modules/.cache\',{recursive:true})"');
    writeFileSync(STAMP, hash);
} catch {
    // A missing stamp only costs a redundant compile next time.
}
