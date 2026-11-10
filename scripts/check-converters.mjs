#!/usr/bin/env node
/**
 * Migration converters: the two checks over server/lib/migration-intake, run as
 * one gate.
 *
 *   converter-capability  every converter is registered, tested and has a declared
 *                         fixture schema (scripts/check-converter-capability.mjs)
 *   converter-literals    no vendor vocabulary is embedded in converter source
 *                         unless it is classified (scripts/check-converter-literals.mjs)
 *
 * Both are plain top-level scripts and are run here unmodified, one after the
 * other, in one process: their messages, counts, positive-control self-test and
 * exit codes are exactly what they print on their own. They read different
 * things (adapter exports against specs and schemas, versus string literals in
 * source), so there is no scan to share; what is shared is the process and the
 * reporting.
 *
 *   node scripts/check-converters.mjs                               both
 *   node scripts/check-converters.mjs --only converter-literals     one of them
 *   node scripts/check-converters.mjs --self-test                   literals' self-test
 *   npm run lint:converter-capability | lint:converter-literals     aliases of --only
 */
import { runCombined, importAsScript } from './lib/combined-gate.mjs';

const argv = process.argv.slice(2);
const at = argv.indexOf('--only');
const checkArgs = at === -1 ? argv : [...argv.slice(0, at), ...argv.slice(at + 2)];
const url = (file) => new URL(file, import.meta.url).href;

const code = await runCombined({
    group: 'converters',
    argv,
    checks: [
        { name: 'converter-capability', run: () => importAsScript(url('./check-converter-capability.mjs'), checkArgs) },
        { name: 'converter-literals', run: () => importAsScript(url('./check-converter-literals.mjs'), checkArgs) },
    ],
});
process.exit(code);
