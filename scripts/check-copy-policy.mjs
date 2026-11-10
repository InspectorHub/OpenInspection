#!/usr/bin/env node
/**
 * Copy policy: the two checks over user-facing copy, run as one gate.
 *
 *   verification-copy  no surface converts an integrity result into a conclusion
 *                      (scripts/check-verification-copy.mjs,
 *                       docs/develop/verification-copy-policy.md)
 *   endorsement-copy   no copy attributes an approval of our output to an authority
 *                      (scripts/check-endorsement-copy.mjs)
 *
 * Both are plain top-level scripts and are run here UNMODIFIED, one after the
 * other, in one process. Their patterns, allow-tags, baselines, messages and exit
 * codes are exactly what they print on their own; this file adds only a header
 * and a verdict around each. They deliberately share nothing else.
 *
 * ⚠️ Run without `--self-test`. Both scripts accept it, and with it they score
 * their patterns against labelled fixtures and exit 0 WITHOUT reading a single
 * catalogue. A registry row that passed it would be green forever while looking
 * at nothing; tests/unit/tooling/gate-registry.spec.ts pins that the row carries
 * no args.
 *
 *   node scripts/check-copy-policy.mjs                                  both
 *   node scripts/check-copy-policy.mjs --only endorsement-copy          one of them
 *   npm run lint:verification-copy | lint:endorsement-copy              aliases of --only
 */
import { runCombined, importAsScript } from './lib/combined-gate.mjs';

const argv = process.argv.slice(2);
const at = argv.indexOf('--only');
const checkArgs = at === -1 ? argv : [...argv.slice(0, at), ...argv.slice(at + 2)];
const url = (file) => new URL(file, import.meta.url).href;

const code = await runCombined({
    group: 'copy-policy',
    argv,
    checks: [
        { name: 'verification-copy', run: () => importAsScript(url('./check-verification-copy.mjs'), checkArgs) },
        { name: 'endorsement-copy', run: () => importAsScript(url('./check-endorsement-copy.mjs'), checkArgs) },
    ],
});
process.exit(code);
