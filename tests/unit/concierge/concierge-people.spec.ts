/**
 * Task 7b (people-role-profiles) — ConciergeService.createBooking inserts
 * `inspections` directly (not via InspectionCoreService.createInspection,
 * which already got the Task 7 people-write). Mirror the agent referral
 * (link.inspectorContactId, already stamped onto referredByAgentId) into
 * inspection_people (buyer_agent), non-fatal like Task 7.
 *
 * FIXED (Task 9b regression): the client contact is now resolved via the
 * same idempotent upsert booking.service/core.ts use (ContactService.
 * upsertClientContact, matched by tenant + normalized email) and mirrored
 * into inspection_people (client), alongside buyer_agent. Without this,
 * ConciergeService.approveByInspector's PeopleService.getPrimaryClient join
 * (Task 9b) never resolves a client for a concierge booking, and every
 * reviewer-mode approval throws BadRequest once the legacy clientEmail
 * column is dropped (Task 13).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { ConciergeService } from '../../../server/services/concierge.service';
import { PeopleService } from '../../../server/services/people.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { logger } from '../../../server/lib/logger';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { EmailService } from '../../../server/services/email.service';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const T1            = '00000000-0000-0000-0000-0000000000a1';
const T1_SUB        = 't1';
const AGENT         = '00000000-0000-0000-0000-0000000000a2';
const INSPECTOR     = '00000000-0000-0000-0000-0000000000a3';
const CONTACT_INSP  = '00000000-0000-0000-0000-0000000000a4'; // contact row in T1 referencing the inspector
const CONTACT_AGENT = '00000000-0000-0000-0000-0000000000a5'; // contact row in T1 referencing the agent

interface SeedOpts { reviewRequired?: boolean; agentLinkStatus?: 'active' | 'pending' | 'revoked' }

async function seedFixture(testDb: BetterSQLite3Database<typeof schema>, opts: SeedOpts = {}) {
    const { reviewRequired = false, agentLinkStatus = 'active' } = opts;
    await testDb.insert(schema.tenants).values({
        id: T1, name: 'Acme', slug: T1_SUB, status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await testDb.insert(schema.tenantConfigs).values({
        tenantId: T1,
        conciergeReviewRequired: reviewRequired,
        updatedAt: new Date(),
    });
    await testDb.insert(schema.users).values([
        // Inspector — tenant-scoped.
        { id: INSPECTOR, tenantId: T1, email: 'mike@acme.com', name: 'Mike Reynolds',
          role: 'inspector', passwordHash: 'x', createdAt: new Date() },
        // Agent — global (tenant_id NULL).
        { id: AGENT, tenantId: null, email: 'jane@realty.com', name: 'Jane Smith',
          role: 'agent', passwordHash: 'x', createdAt: new Date() },
    ]);
    await testDb.insert(schema.contacts).values([
        // The inspector's contact row in T1 (used to identify them in the booking form).
        { id: CONTACT_INSP, tenantId: T1, type: 'client', name: 'Mike Reynolds',
          email: 'mike@acme.com', createdAt: new Date() },
        // The agent's contact row in T1 (used by referredByAgentId reverse-lookup).
        { id: CONTACT_AGENT, tenantId: T1, type: 'agent', name: 'Jane Smith',
          email: 'jane@realty.com', createdAt: new Date() },
    ]);
    await testDb.insert(schema.agentTenantLinks).values({
        id: crypto.randomUUID(),
        agentUserId: AGENT,
        tenantId: T1,
        inspectorContactId: CONTACT_AGENT,
        status: agentLinkStatus,
        invitedByUserId: INSPECTOR,
        createdAt: new Date(),
    });
    await seedRoleProfiles(testDb as any, T1, new Date(1));
}

const baseParams = () => ({
    tenantId: T1,
    agentUserId: AGENT,
    inspectorContactId: CONTACT_INSP,
    date: '2026-06-15',
    timeSlot: '10:00',
    propertyAddress: '1 Main St',
    clientName: 'Sarah Buyer',
    clientEmail: 'sarah@example.com',
    agreementRequired: true,
    paymentRequired: false,
});

describe('ConciergeService.createBooking — writes inspection_people (Task 7b)', () => {
    let svc: ConciergeService;
    let testDb: BetterSQLite3Database<typeof schema>;
    let people: PeopleService;
    let stubEmail: {
        sendConciergeClientConfirm: ReturnType<typeof vi.fn>;
        sendConciergeInspectorReview: ReturnType<typeof vi.fn>;
        sendConciergeConfirmedToAgent: ReturnType<typeof vi.fn>;
        sendConciergeCancelledToAgent: ReturnType<typeof vi.fn>;
    };

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        await setupSchema(fixture.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        stubEmail = {
            sendConciergeClientConfirm:    vi.fn().mockResolvedValue(undefined),
            sendConciergeInspectorReview:  vi.fn().mockResolvedValue(undefined),
            sendConciergeConfirmedToAgent: vi.fn().mockResolvedValue(undefined),
            sendConciergeCancelledToAgent: vi.fn().mockResolvedValue(undefined),
        };
        svc = new ConciergeService({} as D1Database, stubEmail as unknown as EmailService, 'https://acme.example.com');
        people = new PeopleService({ DB: {} as D1Database });
    });

    it('writes the buyer_agent role from the resolved agent-tenant-link contact, plus a client role for the booking client', async () => {
        await seedFixture(testDb, { reviewRequired: false });
        const result = await svc.createBooking(baseParams());

        // Task 13 dropped inspections.referredByAgentId — the buyer_agent link
        // now lives ONLY in inspection_people.
        const rows = await people.listPeople(T1, result.inspectionId);
        expect(rows.map(r => r.roleKey).sort()).toEqual(['buyer_agent', 'client']);
        expect(rows.find(r => r.roleKey === 'buyer_agent')?.contactId).toBe(CONTACT_AGENT);
        const clientRow = rows.find(r => r.roleKey === 'client');
        expect(clientRow?.email).toBe('sarah@example.com');
        expect(clientRow?.name).toBe('Sarah Buyer');

        // Task 9b regression guard: approveByInspector resolves the client via
        // PeopleService.getPrimaryClient — must not throw "no client email on file".
        const primaryClient = await people.getPrimaryClient(T1, result.inspectionId);
        expect(primaryClient?.email).toBe('sarah@example.com');
    });

    it('writes buyer_agent + client in the reviewer (awaiting_inspector) branch too', async () => {
        await seedFixture(testDb, { reviewRequired: true });
        const result = await svc.createBooking(baseParams());

        const rows = await people.listPeople(T1, result.inspectionId);
        expect(rows.map(r => r.roleKey).sort()).toEqual(['buyer_agent', 'client']);
    });

    it('does not fail booking creation when the people-write throws (non-fatal)', async () => {
        await seedFixture(testDb, { reviewRequired: false });
        const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
        const addPersonSpy = vi.spyOn(PeopleService.prototype, 'addPerson').mockRejectedValue(new Error('boom'));

        const result = await svc.createBooking(baseParams());

        expect(addPersonSpy).toHaveBeenCalled();
        const insp = await testDb.select().from(schema.inspections)
            .where(eq(schema.inspections.id, result.inspectionId)).get();
        expect(insp).toBeTruthy();
        expect(errorSpy).toHaveBeenCalled();
    });
});
