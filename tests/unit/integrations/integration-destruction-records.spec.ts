/**
 * `GET /api/platform/destruction-records` — the read side of the purge.
 *
 * `tenant_destruction_records` is the durable, non-personal proof that a
 * workspace's data was physically destroyed. It is written by
 * `POST /api/platform/tenants/:slug/purge` and, until this route existed, was
 * read by nothing at all — so "produce the record of tenant X's destruction"
 * could only be answered by opening D1 by hand.
 *
 * What these specs pin is WHO can ask, because the query itself is deliberately
 * not tenant-scoped (the tenant it names has been deleted and can hold no
 * session). All of the safety therefore lives in the guard and the mode fence:
 *   - no `x-portal-m2m` HMAC ⇒ 403, and
 *   - `APP_MODE=standalone` ⇒ 404 at the worker entry, before the router.
 * The reachability assertion — a record survives its tenant and comes back — is
 * the whole reason the endpoint exists.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { HonoConfig } from '../../../server/types/hono';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import integrationRoutes from '../../../server/portal/integration.routes';
import { signM2mHeader, M2M_HEADER } from '../../../server/lib/m2m-auth';

const FAKE_PEM = `-----BEGIN PRIVATE KEY-----\n${btoa('test-m2m-shared-key-material-0123456789')}\n-----END PRIVATE KEY-----`;
const ENV = { DB: {}, JWT_CURRENT_KID: 'v1', JWT_PRIVATE_KEY_V1: FAKE_PEM } as Record<string, unknown>;

interface RecordsBody {
    success: boolean;
    data: {
        records: Array<{ id: string; tenantId: string; tenantSlug: string | null; rowsDeleted: number; destroyedAt: number }>;
        nextBefore: number | null;
    };
}

describe('GET /api/platform/destruction-records', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];

    function app() { const a = new OpenAPIHono<HonoConfig>(); a.route('/api/platform', integrationRoutes); return a; }
    async function header() { return signM2mHeader(ENV as Record<string, string | undefined>); }

    beforeEach(async () => {
        const s = createTestDb(); testDb = s.db; sqlite = s.sqlite; await setupSchema(sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        // NOTE: no `tenants` rows. These ids name workspaces that were purged —
        // that is the state the table exists to describe.
        await testDb.insert(schema.tenantDestructionRecords).values([
            { id: 'd-old', tenantId: 'ghost-a', tenantSlug: 'ghost-a', rowsDeleted: 10, r2Objects: 1, r2Bytes: 100, kvKeys: 1, destroyedAt: new Date(1_000) },
            { id: 'd-new', tenantId: 'ghost-b', tenantSlug: null,      rowsDeleted: 20, r2Objects: 2, r2Bytes: 200, kvKeys: 2, destroyedAt: new Date(2_000) },
        ] as never);
    });
    afterEach(() => { sqlite.close(); vi.clearAllMocks(); });

    it('403 without the M2M header', async () => {
        const res = await app().request('/api/platform/destruction-records', {}, ENV);
        expect(res.status).toBe(403);
    });

    it('403 with a bogus M2M header', async () => {
        const res = await app().request(
            '/api/platform/destruction-records',
            { headers: { [M2M_HEADER]: 'not-a-real-hmac' } },
            ENV,
        );
        expect(res.status).toBe(403);
    });

    it('returns every record newest first for an authorised operator', async () => {
        const res = await app().request(
            '/api/platform/destruction-records',
            { headers: { [M2M_HEADER]: await header() } },
            ENV,
        );
        expect(res.status).toBe(200);
        const body = await res.json() as RecordsBody;
        expect(body.success).toBe(true);
        expect(body.data.records.map(r => r.id)).toEqual(['d-new', 'd-old']);
        expect(body.data.records[0]).toMatchObject({ tenantId: 'ghost-b', tenantSlug: null, rowsDeleted: 20, destroyedAt: 2_000 });
    });

    it('narrows to one destroyed workspace by tenantId', async () => {
        const res = await app().request(
            '/api/platform/destruction-records?tenantId=ghost-a',
            { headers: { [M2M_HEADER]: await header() } },
            ENV,
        );
        expect(res.status).toBe(200);
        const body = await res.json() as RecordsBody;
        expect(body.data.records.map(r => r.id)).toEqual(['d-old']);
    });

    it('400 on a limit outside the allowed page range', async () => {
        const res = await app().request(
            '/api/platform/destruction-records?limit=0',
            { headers: { [M2M_HEADER]: await header() } },
            ENV,
        );
        expect(res.status).toBe(400);
    });

    it('pages backwards with the returned nextBefore cursor', async () => {
        const first = await app().request(
            '/api/platform/destruction-records?limit=1',
            { headers: { [M2M_HEADER]: await header() } },
            ENV,
        );
        const firstBody = await first.json() as RecordsBody;
        expect(firstBody.data.records.map(r => r.id)).toEqual(['d-new']);
        expect(firstBody.data.nextBefore).toBe(2_000);

        const second = await app().request(
            `/api/platform/destruction-records?limit=1&before=${firstBody.data.nextBefore}`,
            { headers: { [M2M_HEADER]: await header() } },
            ENV,
        );
        const secondBody = await second.json() as RecordsBody;
        expect(secondBody.data.records.map(r => r.id)).toEqual(['d-old']);
    });
});

import workerEntry from '../../../workers/app';
describe('GET /api/platform/destruction-records — standalone gate', () => {
    it('404s in standalone APP_MODE (route family is saas-only)', async () => {
        const req = new Request('https://x/api/platform/destruction-records');
        const res = await workerEntry.fetch(req, { APP_MODE: 'standalone' } as never, {} as never);
        expect(res.status).toBe(404);
    });
});
