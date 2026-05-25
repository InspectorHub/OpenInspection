/**
 * Design System 0520 subsystem C phase 5 task 5.1 — TeamService.createInvite
 * carries the new role-extension fields (assigned sections for
 * specialists, mentor id for apprentices) through onto the tenant_invites
 * row so they can be replayed onto the users row at accept time.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { TeamService } from '../../src/services/team.service';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../src/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-0000000000c1';
const MENTOR = '11111111-1111-1111-1111-1111111111c1';

async function seedTenant(testDb: BetterSQLite3Database<typeof schema>) {
    await testDb.insert(schema.tenants).values({
        id: TENANT, name: 'Acme', subdomain: 'acme-c1', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await testDb.insert(schema.users).values({
        id: MENTOR, tenantId: TENANT, email: 'lead@acme.test',
        passwordHash: 'x', role: 'lead', createdAt: new Date(),
    });
}

describe('TeamService.createInvite — 4-role extensions (subsystem C P5.1)', () => {
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

    it('creates an invite for a specialist with assigned section ids', async () => {
        const out = await svc.createInvite({
            tenantId: TENANT,
            email:    'spec@acme.test',
            role:     'specialist',
            assignedSectionIds: ['s-roof', 's-elec'],
        });

        const row = await testDb.select().from(schema.tenantInvites)
            .where(eq(schema.tenantInvites.id, out.token)).get();
        expect(row?.role).toBe('specialist');
        expect(JSON.parse(row?.assignedSectionIds ?? '[]')).toEqual(['s-roof', 's-elec']);
        expect(row?.mentorId).toBeNull();
    });

    it('creates an apprentice invite with mentor_id', async () => {
        const out = await svc.createInvite({
            tenantId: TENANT,
            email:    'app@acme.test',
            role:     'apprentice',
            mentorId: MENTOR,
        });

        const row = await testDb.select().from(schema.tenantInvites)
            .where(eq(schema.tenantInvites.id, out.token)).get();
        expect(row?.role).toBe('apprentice');
        expect(row?.mentorId).toBe(MENTOR);
        expect(JSON.parse(row?.assignedSectionIds ?? '[]')).toEqual([]);
    });

    it('rejects an apprentice invite without a mentor', async () => {
        await expect(svc.createInvite({
            tenantId: TENANT,
            email:    'app@acme.test',
            role:     'apprentice',
        })).rejects.toThrow(/mentor.*required/i);
    });

    it('rejects when the named mentor does not exist in the tenant', async () => {
        await expect(svc.createInvite({
            tenantId: TENANT,
            email:    'app@acme.test',
            role:     'apprentice',
            mentorId: 'no-such-user',
        })).rejects.toThrow(/mentor/i);
    });

    it('legacy lead/office invites still work with no extra fields', async () => {
        const out = await svc.createInvite({
            tenantId: TENANT,
            email:    'office@acme.test',
            role:     'office',
        });
        const row = await testDb.select().from(schema.tenantInvites)
            .where(eq(schema.tenantInvites.id, out.token)).get();
        expect(row?.role).toBe('office');
        expect(row?.mentorId).toBeNull();
        expect(JSON.parse(row?.assignedSectionIds ?? '[]')).toEqual([]);
    });
});
