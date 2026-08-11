/**
 * Task 10 (two-layer role model) — role-profile edits become permission-bearing,
 * so they join the audit trail staff permission_overrides changes already have.
 * The entry records the BEFORE/AFTER resolved capability sets — "who widened
 * this, and when" is the only question anyone asks of a permission audit.
 *
 * Harness copied from role-profiles-api.spec.ts (OpenAPIHono + onError mapping
 * AppError -> status, real PeopleService over better-sqlite3).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { HonoConfig } from '../../../server/types/hono';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { AppError } from '../../../server/lib/errors';
import { PeopleService } from '../../../server/services/people.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { eq } from 'drizzle-orm';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

import roleProfilesRoutes from '../../../server/api/role-profiles';
import { asD1Db } from '../helpers/test-db';

const TENANT_ID = '00000000-0000-0000-0000-0000000000a1';
const AUDIT_ACTION = 'role_profile.capabilities_updated';

function buildApp() {
    const app = new OpenAPIHono<HonoConfig>();
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
        }
        return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
    });
    app.use('*', async (c, next) => {
        c.set('userRole', 'owner' as HonoConfig['Variables']['userRole']);
        c.set('tenantId', TENANT_ID);
        c.set('user', { sub: 'u-auditor' } as never);
        c.set('services', { people: new PeopleService({ DB: {} as D1Database }) } as unknown as HonoConfig['Variables']['services']);
        await next();
    });
    app.route('/api/role-profiles', roleProfilesRoutes);
    return app;
}

describe('role profile capability audit', () => {
    let db: BetterSQLite3Database<typeof schema>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sqlite: any;

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);
        await db.insert(schema.tenants).values({
            id: TENANT_ID, slug: 't-rpaudit', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await seedRoleProfiles(asD1Db(db), TENANT_ID, new Date(1));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(db);
    });

    afterEach(() => {
        sqlite.close();
        vi.clearAllMocks();
    });

    async function profileByKey(key: string) {
        const row = await db.select().from(schema.contactRoleProfiles)
            .where(eq(schema.contactRoleProfiles.key, key)).get();
        expect(row).toBeTruthy();
        return row!;
    }

    async function auditRows() {
        return db.select().from(schema.auditLogs)
            .where(eq(schema.auditLogs.action, AUDIT_ACTION));
    }

    it('writes an audit entry carrying the before and after capability sets', async () => {
        const attorney = await profileByKey('attorney');
        const res = await buildApp().request(`/api/role-profiles/${attorney.id}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                capabilityOverrides: {
                    receivesReport: true, selfRetrieveReport: false, canHaveAccount: false,
                    showsInAgentPortal: false, canAccessRepairList: 'read',
                },
            }),
        }, { DB: {} });
        expect(res.status).toBe(200);

        const rows = await auditRows();
        expect(rows).toHaveLength(1);
        const meta = rows[0].metadata as { before: { canAccessRepairList: string }; after: { canAccessRepairList: string } };
        expect(meta.before.canAccessRepairList).toBe('off');
        expect(meta.after.canAccessRepairList).toBe('read');
        expect(rows[0].entityId).toBe(attorney.id);
        expect(rows[0].userId).toBe('u-auditor');
    });

    it('writes no capability audit entry when only the label changed', async () => {
        const attorney = await profileByKey('attorney');
        const res = await buildApp().request(`/api/role-profiles/${attorney.id}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ label: 'Real Estate Attorney' }),
        }, { DB: {} });
        expect(res.status).toBe(200);
        expect(await auditRows()).toHaveLength(0);
    });

    it('writes no audit entry when the submitted overrides resolve to the same set', async () => {
        // The modal always submits the FULL explicit set; re-saving without
        // touching anything must not fabricate a permission-change event.
        const attorney = await profileByKey('attorney');
        const res = await buildApp().request(`/api/role-profiles/${attorney.id}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                capabilityOverrides: {
                    receivesReport: true, selfRetrieveReport: false, canHaveAccount: false,
                    showsInAgentPortal: false, canAccessRepairList: 'off',
                },
            }),
        }, { DB: {} });
        expect(res.status).toBe(200);
        expect(await auditRows()).toHaveLength(0);
    });

    it('rejects canHaveAccount on a kind with no account track, and stores nothing', async () => {
        const client = await profileByKey('client');
        const res = await buildApp().request(`/api/role-profiles/${client.id}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                capabilityOverrides: {
                    receivesReport: true, selfRetrieveReport: true, canHaveAccount: true,
                    showsInAgentPortal: false, canAccessRepairList: 'off',
                },
            }),
        }, { DB: {} });
        expect(res.status).toBe(400);
        const body = await res.json() as { error: { message: string } };
        expect(body.error.message).toMatch(/not yet available/i);
        expect(await auditRows()).toHaveLength(0);
        const after = await profileByKey('client');
        expect(after.capabilityOverrides).toEqual(client.capabilityOverrides);
    });

    it('accepts capabilityOverrides on create and persists them', async () => {
        const res = await buildApp().request('/api/role-profiles', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                label: 'Relocation Agent', kind: 'agent',
                capabilityOverrides: {
                    receivesReport: true, selfRetrieveReport: true, canHaveAccount: true,
                    showsInAgentPortal: false, canAccessRepairList: 'off',
                },
            }),
        }, { DB: {} });
        expect(res.status).toBe(201);
        const body = await res.json() as { data: { id: string } };
        const row = await db.select().from(schema.contactRoleProfiles)
            .where(eq(schema.contactRoleProfiles.id, body.data.id)).get();
        expect((row!.capabilityOverrides as { showsInAgentPortal: boolean }).showsInAgentPortal).toBe(false);
    });
});
