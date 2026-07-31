/**
 * Gate result cache — so running a gate twice costs nothing.
 *
 * The gate ladder (`.claude/skills/gate-ladder`) says: do not run a gate the
 * next automatic rung will run. That is a rule people have to remember, and it
 * drifted within the session that wrote it — `lint:filesize` got run four
 * times in one task, and a full `type-check` was run by hand seconds before
 * the hook ran its own.
 *
 * A rule you have to remember is the same shape as the bugs this repo keeps
 * finding: a coupling maintained by prose. So the fix is the same shape too —
 * make the wasteful thing cost nothing, instead of asking anyone to avoid it.
 *
 * KEYED ON WHAT THE GATE READS, NOT ON THE INDEX. The obvious key is
 * `git diff --cached`, and it is wrong: these gates scan the WORKING TREE, so
 * an unstaged edit that introduced a violation would hash identically and the
 * gate would print "cached" over a real failure. That is a false green, which
 * is worse than no cache at all. The key is (gate source) + (path, mtime,
 * size) of every file the gate scans, so any change to an input invalidates it.
 *
 * mtime+size rather than content: the point is to avoid the work, and reading
 * every file to decide whether to read every file saves nothing. `statSync` on
 * ~500 files costs ~15ms against 1–5s for the gates themselves.
 *
 * THREE RULES, because a cache is exactly the mechanism by which a gate can
 * silently stop working:
 *   1. a cache hit PRINTS that it was a hit — never silent
 *   2. any error computing the key runs the gate (fail toward running)
 *   3. any CLI flag (--update, --fix, …) bypasses the cache entirely — those
 *      runs have side effects, and a side effect is not cacheable
 *
 * Disable with `GATE_CACHE=0` when in doubt. CI does not set it: CI runs each
 * gate once on a fresh checkout, so every key misses anyway.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, statSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const CACHE_DIR = join(ROOT, '..', '.gate-cache');

/**
 * @param {string} name        gate id, used as the cache filename
 * @param {string} gateScript  absolute path to the gate's own source
 * @param {string[]} inputs    absolute paths of every file the gate reads
 * @returns {{ hit: boolean, save: () => void, key: string | null }}
 */
export function gateStamp(name, gateScript, inputs) {
    // Rule 3 — a run with flags may have side effects; never cache it.
    const hasFlags = process.argv.slice(2).some((a) => a.startsWith('-'));
    if (hasFlags || process.env.GATE_CACHE === '0') {
        return { hit: false, save: () => {}, key: null };
    }

    let key;
    try {
        const h = createHash('sha256');
        h.update(readFileSync(gateScript, 'utf8'));
        // Sorted so directory-listing order cannot change the key on its own.
        for (const p of [...inputs].sort()) {
            const st = statSync(p);
            h.update(`${relative(ROOT, p)}|${st.mtimeMs}|${st.size}\n`);
        }
        key = h.digest('hex').slice(0, 16);
    } catch {
        // Rule 2 — fail toward running the gate.
        return { hit: false, save: () => {}, key: null };
    }

    const file = join(CACHE_DIR, `${name}.json`);
    let stored = null;
    try { stored = JSON.parse(readFileSync(file, 'utf8')).key; } catch { /* no cache yet */ }

    if (stored === key) {
        // Rule 1 — a hit is visible. Someone reading CI or a hook transcript
        // must be able to tell "passed" from "did not run".
        console.log(`${name}: cached (inputs unchanged, key ${key})`);
        return { hit: true, save: () => {}, key };
    }

    return {
        hit: false,
        key,
        save: () => {
            try {
                mkdirSync(CACHE_DIR, { recursive: true });
                writeFileSync(file, JSON.stringify({ key, at: new Date().toISOString() }));
            } catch { /* a cache that cannot be written is not an error */ }
        },
    };
}

/**
 * Every source file under `roots`, plus `extra` — the input set for a gate that
 * shells out to a tool (knip) and therefore cannot enumerate what it read.
 *
 * A missing root is skipped rather than thrown: an over-broad root list is
 * harmless (extra invalidation), while a throw would silently disable the gate
 * through the fail-open path.
 */
export function collectInputs(roots, extra = []) {
    const out = [...extra];
    const walk = (dir) => {
        let entries;
        try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            if (e.isDirectory()) {
                if (e.name === 'node_modules' || e.name === 'dist' || e.name === 'build' || e.name[0] === '.') continue;
                walk(join(dir, e.name));
            } else if (/\.(tsx?|jsx?|mjs|json)$/.test(e.name)) {
                out.push(join(dir, e.name));
            }
        }
    };
    for (const r of roots) walk(r);
    return out;
}
