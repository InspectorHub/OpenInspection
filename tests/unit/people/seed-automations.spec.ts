/**
 * Spec 2 (people-role-profiles) — Task 5 guard test.
 *
 * report.published is the "did the client actually get their report" trigger:
 * this is the safety guard that a freshly-seeded tenant always has an ACTIVE
 * client rule for it (publish must never silently fail to reach the client),
 * plus the newly-added role-aware rules for the Buyer's Agent (active by
 * default) and Listing Agent (seeded inactive — inspector opts in).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq, and } from 'drizzle-orm';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { AutomationService } from '../../../server/services/automation.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';

const TENANT = '00000000-0000-0000-0000-00000000a5a5';
let db: BetterSQLite3Database<typeof schema>;
let svc: AutomationService;

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db;
    await setupSchema(fx.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    await db.insert(schema.tenants).values({
        id: TENANT, name: 'Acme', slug: 'acme-a5a5', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    // ensureSeeds resolves recipientRoleKey -> contact_role_profiles.id, so
    // role profiles must be seeded first (same order as /setup and
    // seedStarterContent: role profiles, then automations).
    await seedRoleProfiles(db, TENANT, new Date(1));
    svc = new AutomationService({} as D1Database);
});

// Resolve an automations row's recipient role by joining
// recipientRoleProfileId -> contact_role_profiles.key, per the brief's
// preference for asserting the actual recipient rather than just rule name.
async function reportPublishedRuleForRole(roleKey: string) {
    const rows = await db.select({
        active: schema.automations.active,
        roleKey: schema.contactRoleProfiles.key,
    })
        .from(schema.automations)
        .innerJoin(schema.contactRoleProfiles, eq(schema.automations.recipientRoleProfileId, schema.contactRoleProfiles.id))
        .where(and(
            eq(schema.automations.tenantId, TENANT),
            eq(schema.automations.trigger, 'report.published'),
            eq(schema.contactRoleProfiles.key, roleKey),
        ));
    return rows[0];
}

describe('default report.published seeds — role-aware recipients (Spec 2 Task 5)', () => {
    it('seeds an ACTIVE report.published rule for the client (safety guard: publish must always reach the client)', async () => {
        await svc.ensureSeeds(TENANT);
        const rule = await reportPublishedRuleForRole('client');
        expect(rule).toBeDefined();
        expect(rule?.active).toBe(true);
    });

    it("seeds an ACTIVE report.published rule for the buyer's agent", async () => {
        await svc.ensureSeeds(TENANT);
        const rule = await reportPublishedRuleForRole('buyer_agent');
        expect(rule).toBeDefined();
        expect(rule?.active).toBe(true);
    });

    it('seeds an INACTIVE report.published rule for the listing agent (opt-in)', async () => {
        await svc.ensureSeeds(TENANT);
        const rule = await reportPublishedRuleForRole('listing_agent');
        expect(rule).toBeDefined();
        expect(rule?.active).toBe(false);
    });
});
