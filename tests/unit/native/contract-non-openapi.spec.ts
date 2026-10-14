/**
 * The native endpoints OpenAPI cannot describe, pinned here instead.
 *
 * The OpenAPI snapshot covers JSON operations declared through createRoute().
 * WebSocket upgrades, binary bodies, plain JSON routes and the OAuth endpoints
 * live outside it, so a rename or a changed frame constant would pass every
 * schema check while breaking an installed app. Each registry entry is therefore
 * pinned by something executable: the route still answers (not 404), the frame
 * constants still hold, or the OAuth provider still serves the path.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from '../../../server/index';
import { makeExecutionContext } from '../helpers/exec-ctx';
import { createHarness, type Harness } from '../helpers/tenant-email-harness';
import {
    NATIVE_NON_OPENAPI_CONTRACT,
    type NativeNonOpenApiEntry,
} from '../../../server/lib/native/contract-registry';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
function source(relative: string): string {
    return readFileSync(resolve(ROOT, relative), 'utf-8');
}

const served = NATIVE_NON_OPENAPI_CONTRACT.filter((e) => e.kind !== 'oauth');

describe('native non-OpenAPI contract', () => {
    let h: Harness | undefined;
    afterEach(() => { h?.close(); h = undefined; });

    async function status(method: string, path: string): Promise<number> {
        h ??= await createHarness('standalone');
        const exec = makeExecutionContext({ label: 'native-contract' });
        const res = await app.request(path, { method: method.toUpperCase() }, h.env, exec.ctx);
        await exec.settle();
        return res.status;
    }

    function concretePath(entry: NativeNonOpenApiEntry): string {
        return entry.path.replace('{id}', 'x');
    }

    it('pins at least one endpoint of every kind', () => {
        const kinds = new Set(NATIVE_NON_OPENAPI_CONTRACT.map((e) => e.kind));
        expect([...kinds].sort()).toEqual(['binary', 'json', 'oauth', 'websocket']);
    });

    it('reports a path that does not exist as 404 (positive control for the route checks below)', async () => {
        expect(await status('get', '/api/inspections/x/collab/native-contract-control')).toBe(404);
    });

    it.each(served.map((e) => [`${e.method.toUpperCase()} ${e.path}`, e] as const))(
        '%s is still routed (not 404)',
        async (_label, entry) => {
            expect(await status(entry.method, concretePath(entry))).not.toBe(404);
        },
    );

    it('keeps the collab frame constants the app decodes', () => {
        const doc = source('server/durable-objects/inspection-doc.ts');
        expect(doc).toMatch(/\bconst MSG_SYNC = 0;/);
        expect(doc).toMatch(/\bconst MSG_RESTORE = 2;/);
    });

    it.each(NATIVE_NON_OPENAPI_CONTRACT.filter((e) => e.kind === 'oauth').map((e) => [e.path] as const))(
        'the OAuth provider is still configured to serve %s',
        (path) => {
            expect(source('server/lib/mcp/oauth-provider.ts')).toContain(`'${path}'`);
        },
    );
});
