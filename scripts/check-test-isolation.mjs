#!/usr/bin/env node
/**
 * Test isolation: the two checks that a spec listed as sharing a module registry
 * really may, run as one gate.
 *
 *   unit-isolation  tests/unit/isolation.json against the api unit specs
 *                   (scripts/check-unit-isolation.mjs, rules in lib/unit-isolation.mjs)
 *   web-isolation   tests/web-isolation.json against the web specs
 *                   (scripts/check-web-isolation.mjs, rules in lib/web-isolation.mjs)
 *
 * They read different manifests and different spec sets, so there is no scan to
 * share; what is shared is the process and the reporting. Each check keeps its
 * own messages, counts, advisory note and exit semantics, and each still fails
 * on an empty shared list.
 *
 *   node scripts/check-test-isolation.mjs                          both
 *   node scripts/check-test-isolation.mjs --only web-isolation     one of them
 *   npm run lint:unit-isolation | lint:web-isolation               aliases of --only
 */
import { runCombined } from './lib/combined-gate.mjs';
import { run as runUnit } from './check-unit-isolation.mjs';
import { run as runWeb } from './check-web-isolation.mjs';

const code = await runCombined({
    group: 'test-isolation',
    checks: [
        { name: 'unit-isolation', run: runUnit },
        { name: 'web-isolation', run: runWeb },
    ],
});
process.exit(code);
