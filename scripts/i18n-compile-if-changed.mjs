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
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const OUT_DIR = 'app/paraglide';
// The stamp is written to TWO places, and either one is enough to skip.
//
//   app/paraglide/.inputs-hash  — inside the output, so anything that caches or
//     restores `app/paraglide` (CI does) carries the record of which inputs
//     produced it. A restored directory is then trusted for exactly those inputs
//     instead of recompiling on every fresh checkout.
//
//   node_modules/.cache/…       — outside it, because the compiler CLEANS its
//     outdir, and `paraglideVitePlugin` in vite.config.ts writes to the same
//     `./app/paraglide` with the same options. So every `npm run dev` and every
//     `npm run build` silently deleted the in-output stamp, and the next commit
//     that staged `messages/**` paid the full 66s for inputs that had not moved.
//     Vite's output is byte-equivalent (same project, outdir, strategy,
//     outputStructure and emitTsDeclarations), so trusting this copy is sound.
const STAMPS = ['app/paraglide/.inputs-hash', 'node_modules/.cache/i18n-inputs-hash'];
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

/**
 * Called after a successful compile AND after a skip. The skip case matters:
 * when only one of the two locations still holds the hash, this is what
 * restores the other — otherwise a wiped in-output stamp would never come back
 * and every fresh clone would be one full compile away from a warm cache.
 */
function writeStamps(value) {
    for (const p of STAMPS) {
        try {
            mkdirSync(dirname(p), { recursive: true });
            writeFileSync(p, value);
        } catch {
            // A missing stamp only costs a redundant compile next time — and the
            // other copy still votes, so one unwritable location is not fatal.
        }
    }
}

const hash = inputHash();

if (force) {
    console.log('[i18n] --force: compiling.');
    compile();
} else if (!existsSync(OUT_DIR)) {
    console.log(`[i18n] ${OUT_DIR} missing — compiling.`);
    compile();
} else {
    const seen = STAMPS.map((p) => {
        try {
            return readFileSync(p, 'utf8').trim();
        } catch {
            return null; // No stamp yet, or unreadable — that one does not vote.
        }
    });
    if (seen.includes(hash)) {
        console.log('[i18n] inputs unchanged — skipped.');
        writeStamps(hash);
        process.exit(0);
    }
    console.log(seen.some(Boolean) ? '[i18n] inputs changed — compiling.' : '[i18n] no stamp — compiling.');
    compile();
}

// Stamp only AFTER a compile that did not throw: recording the hash for a failed
// run would make the next one skip and leave app/paraglide half-written.
writeStamps(hash);
