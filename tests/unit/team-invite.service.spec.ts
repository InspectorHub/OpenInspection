/**
 * TeamService.createInvite — roles collapsed to owner/admin/inspector/agent
 * (2026-06-13). The apprentice mentor-id and specialist assigned-section
 * extension fields were removed; createInvite now only carries the canonical
 * role onto the tenant_invites row.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { TeamService } from '../../server/services/team.service';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-0000000000c1';
const ADMIN = '11111111-1111-1111-1111-1111111111c1';

async function seedTenant(testDb: BetterSQLite3Database<typeof schema>) {
    await testDb.insert(schema.tenants).values({
        id: TENANT, name: 'Acme', slug: 'acme-c1', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await testDb.insert(schema.users).values({
        id: ADMIN, tenantId: TENANT, email: 'admin@acme.test',
        passwordHash: 'x', role: 'admin', createdAt: new Date(),
    });
}

describe('TeamService.createInvite — canonical roles', () => {
    let svc: TeamService;
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        await seedTenant(testDb);
        svc = new TeamService({} as D1Database);
    });

    it('creates an inspector invite', async () => {
        const out = await svc.createInvite({
            tenantId: TENANT,
            email:    'insp@acme.test',
            role:     'inspector',
        });

        const row = await testDb.select().from(schema.tenantInvites)
            .where(eq(schema.tenantInvites.id, out.token)).get();
        expect(row?.role).toBe('inspector');
        // Extension columns default to empty/null — no longer written.
        expect(row?.mentorId).toBeNull();
        expect(JSON.parse(row?.assignedSectionIds ?? '[]')).toEqual([]);
    });

    it('creates an admin invite', async () => {
        const out = await svc.createInvite({
            tenantId: TENANT,
            email:    'office@acme.test',
            role:     'admin',
        });
        const row = await testDb.select().from(schema.tenantInvites)
            .where(eq(schema.tenantInvites.id, out.token)).get();
        expect(row?.role).toBe('admin');
        expect(row?.mentorId).toBeNull();
        expect(JSON.parse(row?.assignedSectionIds ?? '[]')).toEqual([]);
    });

    it('stores only the overrides that differ from the role template', async () => {
        // Inspector template = publish:true, scheduleOthers:false, financial:false,
        // manageContacts:false. publish:true matches the template (dropped);
        // scheduleOthers:true differs (kept).
        const out = await svc.createInvite({
            tenantId: TENANT,
            email:    'diff@acme.test',
            role:     'inspector',
            permissionOverrides: { publish: true, scheduleOthers: true },
        });
        const row = await testDb.select().from(schema.tenantInvites)
            .where(eq(schema.tenantInvites.id, out.token)).get();
        expect(row?.permissionOverrides).toEqual({ scheduleOthers: true });
    });

    it('stores null when every requested override equals the role template', async () => {
        const out = await svc.createInvite({
            tenantId: TENANT,
            email:    'samedefault@acme.test',
            role:     'inspector',
            permissionOverrides: { publish: true, financial: false },
        });
        const row = await testDb.select().from(schema.tenantInvites)
            .where(eq(schema.tenantInvites.id, out.token)).get();
        expect(row?.permissionOverrides ?? null).toBeNull();
    });

    it('stores null when no overrides are supplied', async () => {
        const out = await svc.createInvite({
            tenantId: TENANT,
            email:    'none@acme.test',
            role:     'manager',
        });
        const row = await testDb.select().from(schema.tenantInvites)
            .where(eq(schema.tenantInvites.id, out.token)).get();
        expect(row?.permissionOverrides ?? null).toBeNull();
    });
});
