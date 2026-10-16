/**
 * Auto-sign on publish names its publisher, and only a publisher who may speak for the
 * assigned inspector stamps their stored signature. Staff cannot publish at all.
 *
 * Every refusal is paired with a publisher it does not apply to.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import { asD1Db } from '../helpers/test-db';
import * as schema from '../../../server/lib/db/schema';
import { applyAutoSignatureOnPublish, maySignFor } from '../../../server/lib/inspection/auto-sign';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';
import type { UserRole } from '../../../server/types/auth';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
// eslint-disable-next-line import/order
import { inspectionsRoutes } from '../../../server/api/inspections';

const T = '00000000-0000-0000-0000-000000000001';
const OTHER_T = '00000000-0000-0000-0000-000000000002';
const INSPECTOR = '00000000-0000-0000-0000-0000000000a1';
const OWNER = '00000000-0000-0000-0000-0000000000b1';
const HELPER = '00000000-0000-0000-0000-0000000000c1';
const STAFF = '00000000-0000-0000-0000-0000000000d1';
const JOB = 'job-1';
const SIG = 'data:image/png;base64,SIGNATURE';

let db: BetterSQLite3Database<typeof schema>;

async function signatureOf() {
    const row = await db.select().from(schema.inspectionResults).where(eq(schema.inspectionResults.inspectionId, JOB)).get();
    return (row?.data as Record<string, unknown> | undefined)?._inspector_signature as Record<string, unknown> | undefined;
}
const run = (actor?: { userId: string; role: string | undefined }) => applyAutoSignatureOnPublish(asD1Db(db), T, JOB, actor);

beforeEach(async () => {
    const fix = createTestDb();
    db = fix.db as BetterSQLite3Database<typeof schema>;
    await setupSchema(fix.sqlite);
    const now = new Date();
    await db.insert(schema.tenants).values([
        { id: T, slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: now },
        { id: OTHER_T, slug: 'other', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: now },
    ]);
    await db.insert(schema.users).values([
        { id: INSPECTOR, tenantId: T, email: 'i@example.com', passwordHash: 'h', role: 'inspector', defaultSignatureBase64: SIG, createdAt: now },
        { id: OWNER, tenantId: T, email: 'o@example.com', passwordHash: 'h', role: 'owner', createdAt: now },
        { id: HELPER, tenantId: T, email: 'h@example.com', passwordHash: 'h', role: 'inspector', createdAt: now },
        { id: STAFF, tenantId: T, email: 's@example.com', passwordHash: 'h', role: 'staff', createdAt: now },
    ]);
    await db.insert(schema.inspections).values({
        id: JOB, tenantId: T, propertyAddress: '1 Main St', date: '2026-06-01', inspectorId: INSPECTOR, status: 'completed',
        reportStatus: 'submitted', autoSignOnPublish: true, price: 0, createdAt: now,
    });
    await db.insert(schema.inspectionResults).values({ id: 'res-1', tenantId: T, inspectionId: JOB, data: { item1: { rating: 'good' } }, lastSyncedAt: now });
});

describe('who may sign for the assigned inspector', () => {
    it('is the inspector, an owner or a manager; never a helper, staff, or nobody', () => {
        expect(maySignFor({ userId: INSPECTOR, role: 'inspector' }, INSPECTOR)).toBe(true);
        expect(maySignFor({ userId: OWNER, role: 'owner' }, INSPECTOR)).toBe(true);
        expect(maySignFor({ userId: 'm', role: 'manager' }, INSPECTOR)).toBe(true);
        expect(maySignFor({ userId: HELPER, role: 'inspector' }, INSPECTOR)).toBe(false);
        expect(maySignFor({ userId: STAFF, role: 'staff' }, INSPECTOR)).toBe(false);
        expect(maySignFor({ userId: STAFF, role: undefined }, INSPECTOR)).toBe(false);
        expect(maySignFor(undefined, INSPECTOR)).toBe(false);
    });
});

describe('applyAutoSignatureOnPublish', () => {
    it('stamps the inspector signature for the inspector, recording that they published it themselves', async () => {
        await run({ userId: INSPECTOR, role: 'inspector' });
        expect(await signatureOf()).toMatchObject({ signatureBase64: SIG, userId: INSPECTOR, auto: true, publishedBy: INSPECTOR, onBehalfOf: null });
    });

    it('stamps the inspector signature when an owner publishes, naming the owner and the inspector represented', async () => {
        await run({ userId: OWNER, role: 'owner' });
        expect(await signatureOf()).toMatchObject({ signatureBase64: SIG, userId: INSPECTOR, publishedBy: OWNER, onBehalfOf: INSPECTOR });
    });

    it('keeps the existing results when it stamps', async () => {
        await run({ userId: OWNER, role: 'owner' });
        const row = await db.select().from(schema.inspectionResults).where(eq(schema.inspectionResults.inspectionId, JOB)).get();
        expect((row?.data as Record<string, unknown>).item1).toEqual({ rating: 'good' });
    });

    it.each([
        ['a helper inspector', { userId: HELPER, role: 'inspector' }],
        ['office staff', { userId: STAFF, role: 'staff' }],
        ['no named publisher', undefined],
    ])('does not stamp for %s, and leaves the results as they were', async (_name, actor) => {
        await run(actor);
        expect(await signatureOf()).toBeUndefined();
    });

    it('does not stamp when the flag is off, even for the inspector (control for the stamps above)', async () => {
        await db.update(schema.inspections).set({ autoSignOnPublish: false }).where(eq(schema.inspections.id, JOB));
        await run({ userId: INSPECTOR, role: 'inspector' });
        expect(await signatureOf()).toBeUndefined();
    });

    it('does not use a signature of an inspector id that belongs to another company', async () => {
        await db.update(schema.users).set({ tenantId: OTHER_T }).where(eq(schema.users.id, INSPECTOR));
        await run({ userId: OWNER, role: 'owner' });
        expect(await signatureOf()).toBeUndefined();
    });
});

describe('publish routes', () => {
    const publishService = vi.fn();

    function buildApp(role: UserRole, overrides: Record<string, boolean> | null = null) {
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
        const app = new OpenAPIHono<HonoConfig>();
        app.onError((err, c) => (err instanceof AppError
            ? c.json({ success: false, error: { code: err.code, message: err.message } }, err.status)
            : c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500)));
        app.use('*', async (c, next) => {
            c.set('tenantId', T);
            c.set('userRole', role);
            c.set('user', { sub: role === 'owner' ? OWNER : STAFF, role, tenantId: T });
            c.set('sdb', { getById: async () => ({ permissionOverrides: overrides }) } as unknown as HonoConfig['Variables']['sdb']);
            c.set('services', { inspection: { publishInspection: publishService } } as unknown as HonoConfig['Variables']['services']);
            await next();
        });
        app.route('/api/inspections', inspectionsRoutes);
        return app;
    }
    const post = (app: ReturnType<typeof buildApp>, path: string) =>
        app.request(`/api/inspections/${JOB}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, { DB: {} } as HonoConfig['Bindings']);

    beforeEach(() => { publishService.mockReset().mockRejectedValue(new Error('stop after the call')); });

    it('refuses staff publish, unpublish and return, even when an override says publish is on, and never reaches the service', async () => {
        const staff = buildApp('staff', { publish: true });
        for (const path of ['/publish', '/unpublish', '/return']) expect((await post(staff, path)).status, path).toBe(403);
        expect(publishService).not.toHaveBeenCalled();
    });

    it('control: an owner reaches the publish service, which is told who publishes', async () => {
        await post(buildApp('owner'), '/publish');
        expect(publishService).toHaveBeenCalledTimes(1);
        expect(publishService.mock.calls[0]?.[2]).toMatchObject({ actor: { userId: OWNER, role: 'owner' } });
    });
});
