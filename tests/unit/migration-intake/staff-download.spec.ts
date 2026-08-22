/**
 * `GET /api/integration/migration-runs/:batchId/source` — the operator side of
 * an assisted import, and the first thing in this pipeline that can make opening
 * somebody else's file leave a trace.
 *
 * `staff-access.ts` states the gap this closes in its own words: the rule it
 * enforces "cannot prevent a file from having been opened — that happens in
 * object storage, where no code of ours is watching." Until this route there was
 * no code of ours in the path at all. Now there is one, and the whole point of
 * it is that the bytes and the audit row leave together or neither does.
 *
 * ⚠️ The audit write here is AWAITED, which is a deliberate departure from the
 * house pattern (`auditFromContext` is fire-and-forget so that recording an
 * event can never fail a request that already happened). The specs below pin
 * that departure, because a reader who "fixes" it back to the house pattern
 * restores the exact defect.
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
import { signM2mHeader, M2M_HEADER, type PlatformActor } from '../../../server/lib/m2m-auth';

const FAKE_PEM = `-----BEGIN PRIVATE KEY-----\n${btoa('test-m2m-shared-key-material-0123456789')}\n-----END PRIVATE KEY-----`;

const TENANT = '00000000-0000-0000-0000-0000000000t1';
const AUTHORISED = 'batch-authorised';
const UNAUTHORISED = 'batch-unauthorised';
const SOURCE_KEY = `tenants/${TENANT}/migration/${AUTHORISED}.csv`;
const UPLOADED = new TextEncoder().encode('name,email\nJane,jane@example.test\n');

const PLATFORM_ACTOR: PlatformActor = { platformAdminId: 'pa-7', email: 'ops@inspectorhub.io' };

/** Just enough R2 to serve one stored object. */
function bucketWith(objects: Record<string, Uint8Array>): R2Bucket {
    return {
        get: async (key: string) => {
            const bytes = objects[key];
            if (!bytes) return null;
            return { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
        },
    } as unknown as R2Bucket;
}

async function sha256(bytes: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('GET /api/integration/migration-runs/:batchId/source', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];
    let env: Record<string, unknown>;

    function app() { const a = new OpenAPIHono<HonoConfig>(); a.route('/api/integration', integrationRoutes); return a; }

    async function m2mGet(batchId: string, actor: PlatformActor | undefined) {
        const header = await signM2mHeader(env as Record<string, string | undefined>, actor);
        return app().request(`/api/integration/migration-runs/${batchId}/source`, { headers: { [M2M_HEADER]: header } }, env);
    }

    async function lastAuditRow() {
        const rows = await testDb.select().from(schema.auditLogs).all();
        return rows[rows.length - 1];
    }

    beforeEach(async () => {
        const s = createTestDb(); testDb = s.db; sqlite = s.sqlite; await setupSchema(sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        env = {
            DB: {}, JWT_CURRENT_KID: 'v1', JWT_PRIVATE_KEY_V1: FAKE_PEM,
            PHOTOS: bucketWith({ [SOURCE_KEY]: UPLOADED }),
        };
        await testDb.insert(schema.tenants).values({
            id: TENANT, slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        const base = {
            tenantId: TENANT, createdBy: 'u-1', intent: 'templates.create' as const,
            vendor: 'spectora', adapterName: 'spectora', adapterVersion: '1',
            manifest: '{}', status: 'needs_assistance' as const, createdAt: new Date(),
            sourceKey: SOURCE_KEY,
        };
        await testDb.insert(schema.migrationBatches).values([
            {
                ...base, id: AUTHORISED,
                staffAccessAuthorizedBy: 'u-1',
                staffAccessAuthorizedAt: new Date(),
                staffAccessAuthorizationVersion: 'v1',
            },
            // All three authorisation columns empty — `assertStaffAccessAuthorized`
            // says a `by` with no `at` is a row somebody half-wrote, and that any
            // of the three missing means there is no authorisation to point at.
            { ...base, id: UNAUTHORISED },
        ] as never);
    });
    afterEach(() => { sqlite.close(); vi.clearAllMocks(); });

    it('returns the bytes the operator uploaded', async () => {
        const res = await m2mGet(AUTHORISED, PLATFORM_ACTOR);
        expect(res.status).toBe(200);
        expect(await sha256(new Uint8Array(await res.arrayBuffer()))).toBe(await sha256(UPLOADED));
    });

    it('writes an audit row naming the platform actor, in the same call', async () => {
        await m2mGet(AUTHORISED, PLATFORM_ACTOR);
        // No `await new Promise(setTimeout)` here, and that absence is the
        // assertion: the row must already exist when the response resolves.
        const row = await lastAuditRow();
        expect(row?.action).toBe('migration.source_downloaded');
        expect(row?.actorKind).toBe('platform_staff');
        expect(row?.platformActorId).toBe(PLATFORM_ACTOR.platformAdminId);
        expect(row?.tenantId).toBe(TENANT);
        expect(row?.entityId).toBe(AUTHORISED);
    });

    it('SERVES NOTHING when the audit row cannot be written', async () => {
        // The assertion that actually pins the awaited write, and it had to be
        // written this way: asserting "the row exists when the response
        // resolves" passes even with a fire-and-forget write, because the
        // in-memory database settles within the same microtask queue. It is only
        // by making the write FAIL that the two implementations diverge — one
        // refuses, the other serves the bytes and returns 200 with no record.
        sqlite.exec('DROP TABLE audit_logs');
        const res = await m2mGet(AUTHORISED, PLATFORM_ACTOR);
        expect(res.status).toBe(500);
        expect((await res.arrayBuffer()).byteLength).not.toBe(UPLOADED.byteLength);
    });

    it('writes ONE row per call, so the log counts openings and not runs', async () => {
        await m2mGet(AUTHORISED, PLATFORM_ACTOR);
        await m2mGet(AUTHORISED, PLATFORM_ACTOR);
        const rows = await testDb.select().from(schema.auditLogs).all();
        expect(rows).toHaveLength(2);
    });

    it('refuses a run whose staff access was never authorised', async () => {
        const res = await m2mGet(UNAUTHORISED, PLATFORM_ACTOR);
        expect(res.status).toBe(403);
        // And leaves no row claiming somebody looked at it.
        expect(await testDb.select().from(schema.auditLogs).all()).toHaveLength(0);
    });

    it('POSITIVE CONTROL — an authorised run IS served', async () => {
        // Without this, the refusal above passes for a route that refuses
        // everything, which is a different bug wearing the same green.
        expect((await m2mGet(AUTHORISED, PLATFORM_ACTOR)).status).toBe(200);
    });

    it('refuses when the seam carried no actor', async () => {
        // Provisioning routes run with no acting person, and that is right for
        // them. This one may not: an unattributable download is the thing being
        // fixed, and serving one would produce a row that names nobody.
        const res = await m2mGet(AUTHORISED, undefined);
        expect(res.status).toBe(403);
        expect(await testDb.select().from(schema.auditLogs).all()).toHaveLength(0);
    });

    it('404s a run that does not exist, without inventing a tenant', async () => {
        expect((await m2mGet('no-such-batch', PLATFORM_ACTOR)).status).toBe(404);
    });

    it('404s when the stored file is already gone', async () => {
        // The retention sweep deletes these. A run whose file expired is a normal
        // thing to ask for and must not read as a permission failure.
        env['PHOTOS'] = bucketWith({});
        expect((await m2mGet(AUTHORISED, PLATFORM_ACTOR)).status).toBe(404);
    });
});
