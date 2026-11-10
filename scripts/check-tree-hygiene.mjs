#!/usr/bin/env node
/**
 * Tree hygiene: the three checks that walk the whole tree for a file that is
 * invisible to some tool, run as one gate.
 *
 *   raw-nul         a raw NUL byte makes a text file binary to git grep and ripgrep
 *                   (scripts/check-raw-nul.mjs holds the reasoning)
 *   eol             CRLF or a lone CR in a tracked text file
 *                   (scripts/check-line-endings.mjs)
 *   ext-collisions  `foo.ts` beside `foo.tsx`: one of them is invisible to tsc
 *                   (scripts/check-extension-collisions.mjs)
 *
 * raw-nul and eol read the same thing -- the bytes of every tracked text file --
 * so the tracked list is taken once and each file is read once for both. The
 * extension check walks directories for names only and has nothing to share.
 *
 * Every check keeps its own messages, counts, escape hatches and exit
 * semantics; this file only runs them in one process and labels each result.
 * Each also still runs on its own:
 *
 *   node scripts/check-tree-hygiene.mjs                       all three
 *   node scripts/check-tree-hygiene.mjs --only eol            one of them
 *   node scripts/check-tree-hygiene.mjs --only eol --fix      eol's rewrite
 *   npm run lint:raw-nul | lint:eol | lint:ext-collisions     aliases of --only
 */
import { runCombined, importAsScript } from './lib/combined-gate.mjs';
import { treeContext } from './lib/tree-files.mjs';
import { run as runRawNul } from './check-raw-nul.mjs';
import { run as runLineEndings } from './check-line-endings.mjs';

const argv = process.argv.slice(2);
// Arguments for the checks themselves (`--fix`, `--self-test`), without --only.
const at = argv.indexOf('--only');
const checkArgs = at === -1 ? argv : [...argv.slice(0, at), ...argv.slice(at + 2)];
const ctx = treeContext(checkArgs);

const code = await runCombined({
    group: 'tree-hygiene',
    argv,
    checks: [
        { name: 'raw-nul', run: () => runRawNul(ctx) },
        { name: 'eol', run: () => runLineEndings(ctx) },
        {
            name: 'ext-collisions',
            run: () => importAsScript(new URL('./check-extension-collisions.mjs', import.meta.url).href),
        },
    ],
});
process.exit(code);
