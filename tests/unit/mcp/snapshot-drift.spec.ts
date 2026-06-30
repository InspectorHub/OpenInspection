/**
 * OpenAPI snapshot drift gate.
 *
 * Fails CI when the live API diverges from the committed snapshot at
 * server/lib/mcp/openapi-snapshot.json.
 *
 * To fix: run `npm run mcp:snapshot` to regenerate the committed snapshot,
 * then commit the updated file.
 *
 * Mechanism mirrors route-metadata.spec.ts: import the Hono app directly and
 * call app.getOpenAPIDocument() — the vitest harness stubs cloudflare:workers
 * so this works in plain Node without a live Worker runtime.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from '../../../server/index';
import { reduceOpenApiDoc, type SnapshotEntry } from '../../../server/lib/mcp/snapshot-helpers';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = resolve(__dirname, '../../../server/lib/mcp/openapi-snapshot.json');

function loadCommitted(): SnapshotEntry[] {
    return JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf-8')) as SnapshotEntry[];
}

describe('openapi snapshot drift', { timeout: 30_000 }, () => {
    it('live /doc matches committed openapi-snapshot.json (run `npm run mcp:snapshot` to fix)', () => {
        const doc = app.getOpenAPIDocument({
            openapi: '3.0.0',
            info: { version: 'snapshot', title: 'OpenInspection Core API' },
        });
        const fresh = reduceOpenApiDoc(
            doc as { paths?: Record<string, Record<string, unknown>> },
        );
        const committed = loadCommitted();
        expect(fresh).toEqual(committed);
    });
});
