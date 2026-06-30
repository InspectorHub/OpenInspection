/**
 * Snapshot generator — writes server/lib/mcp/openapi-snapshot.json.
 *
 * Invoked via `npm run mcp:snapshot` (which sets GENERATE_SNAPSHOT=true and
 * calls vitest with this file). The describe block is skipped during normal
 * `npm run test:unit` runs so it does not pollute the CI test suite.
 *
 * Mechanism: we cannot boot the app under plain Node because server/index.ts
 * transitively imports `cloudflare:workers` (a runtime-only module). The vitest
 * harness already stubs it via a path alias (tests/unit/stubs/cloudflare-workers.ts),
 * so we piggyback on that harness rather than inventing a new boot path.
 */
import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from '../../../server/index';
import { reduceOpenApiDoc } from '../../../server/lib/mcp/snapshot-helpers';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = resolve(__dirname, '../../../server/lib/mcp/openapi-snapshot.json');

describe.runIf(process.env['GENERATE_SNAPSHOT'] === 'true')(
    'snapshot generator',
    { timeout: 30_000 },
    () => {
        it('writes openapi-snapshot.json', () => {
            const doc = app.getOpenAPIDocument({
                openapi: '3.0.0',
                info: { version: 'snapshot', title: 'OpenInspection Core API' },
            });
            const entries = reduceOpenApiDoc(
                doc as { paths?: Record<string, Record<string, unknown>> },
            );
            expect(entries.length, 'snapshot must be non-empty').toBeGreaterThan(0);
            expect(entries.every((e) => e.operationId !== ''), 'every entry must have operationId').toBe(
                true,
            );
            expect(entries.every((e) => Array.isArray(e.scopes)), 'every entry must have scopes array').toBe(true);
            expect(entries.every((e) => e.tag !== ''), 'every entry must have a tag').toBe(true);
            expect(entries.every((e) => e.tier !== ''), 'every entry must have a tier').toBe(true);
            writeFileSync(SNAPSHOT_PATH, JSON.stringify(entries, null, 2) + '\n', 'utf-8');
            console.log(`[mcp:snapshot] Wrote ${entries.length} entries → ${SNAPSHOT_PATH}`);
        });
    },
);
