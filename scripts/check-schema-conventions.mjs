#!/usr/bin/env node
/**
 * Schema conventions: the two checks that read server/lib/db/schema/*.ts line by
 * line, run as one gate over one listing of the directory.
 *
 *   timestamps  `*_at` columns are integer timestamp_ms, never seconds or text
 *               (scripts/check-timestamps.mjs holds the rules and the escape hatch)
 *   naming      boolean columns start is_/has_, predicates are never text
 *               (scripts/check-naming.mjs)
 *
 * Each check keeps its own violation messages, `*-lint-ok:` opt-out and exit
 * semantics, and each refuses to report OK over zero schema files. This file
 * only lists the directory once and runs both.
 *
 *   node scripts/check-schema-conventions.mjs                 both
 *   node scripts/check-schema-conventions.mjs --only naming   one of them
 *   npm run lint:timestamps | lint:naming                     aliases of --only
 */
import { runCombined } from './lib/combined-gate.mjs';
import { collectTsFiles, run as runTimestamps } from './check-timestamps.mjs';
import { run as runNaming } from './check-naming.mjs';

const files = collectTsFiles('server/lib/db/schema');

const code = await runCombined({
    group: 'schema-conventions',
    checks: [
        { name: 'timestamps', run: () => runTimestamps(files) },
        { name: 'naming', run: () => runNaming(files) },
    ],
});
process.exit(code);
