/**
 * Drift guard: asserts every ERASURE_MANIFEST rule is referenced in the
 * erasure-orchestrator.ts source, preventing silent manifest↔orchestrator
 * divergence (fix I-1).
 *
 * The anonymize satellite-PII column set lives in the shared `anonymize-pii.ts`
 * module (consumed by BOTH the orchestrator and the retention sweep so they
 * cannot drift), so the anonymize-column scan binds the orchestrator source AND
 * that shared module.
 *
 * Cross-references:
 *   - Manifest:      server/lib/compliance/erasure-manifest.ts
 *   - Orchestrator:  server/lib/compliance/erasure-orchestrator.ts
 *   - Shared SETs:   server/lib/compliance/anonymize-pii.ts
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ERASURE_MANIFEST } from '../../../server/lib/compliance/erasure-manifest';

/** snake_case -> camelCase (single underscore groups; does not handle acronyms). */
function toCamelCase(snake: string): string {
    return snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

const orchestratorPath = path.resolve(
    __dirname,
    '../../../server/lib/compliance/erasure-orchestrator.ts',
);
const sharedAnonymizePath = path.resolve(
    __dirname,
    '../../../server/lib/compliance/anonymize-pii.ts',
);
// Anonymize columns are defined in the shared SET module and consumed by the
// orchestrator; scan both so the binding holds wherever the columns live.
const orchestratorSource =
    fs.readFileSync(orchestratorPath, 'utf8') +
    fs.readFileSync(sharedAnonymizePath, 'utf8');

describe('erasure-manifest coverage', () => {
    it('every anonymize rule column (camelCase) appears in the orchestrator source', () => {
        const anonymizeRules = ERASURE_MANIFEST.filter((r) => r.action === 'anonymize');
        const missing: string[] = [];

        for (const rule of anonymizeRules) {
            const camel = toCamelCase(rule.column);
            if (!orchestratorSource.includes(camel)) {
                missing.push(`${rule.table}.${rule.column} (camelCase: ${camel})`);
            }
        }

        expect(missing, `Orchestrator missing anonymize columns: ${missing.join(', ')}`).toHaveLength(0);
    });

    it('every delete/null rule table is referenced in the orchestrator source', () => {
        const actionRules = ERASURE_MANIFEST.filter(
            (r) => r.action === 'delete' || r.action === 'null',
        );
        // Collect unique tables.
        const tables = [...new Set(actionRules.map((r) => r.table))];
        const missing: string[] = [];

        for (const table of tables) {
            // The orchestrator imports the Drizzle table object whose name is
            // the camelCase form of the DB table name.
            const camel = toCamelCase(table);
            if (!orchestratorSource.includes(camel)) {
                missing.push(`${table} (camelCase: ${camel})`);
            }
        }

        expect(missing, `Orchestrator missing delete/null tables: ${missing.join(', ')}`).toHaveLength(0);
    });
});
