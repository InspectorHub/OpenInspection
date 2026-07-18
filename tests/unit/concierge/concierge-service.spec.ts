import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { ConciergeService } from '../../../server/services/concierge.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { hashToken } from '../../../server/lib/token-hash';
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
    // Task 9c-X2 — confirmByClient's agent-notify now resolves the buyer_agent
    // contact via inspection_people, which createBooking only populates when
    // role profiles exist for the tenant (see its try/catch mirror-write).
    await seedRoleProfiles(testDb, T1, new Date(1));
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

describe('ConciergeService — A3', () => {
    let svc: ConciergeService;
    let testDb: BetterSQLite3Database<typeof schema>;
    let stubEmail: {
        sendConciergeClientConfirm: ReturnType<typeof vi.fn>;
        sendConciergeInspectorReview: ReturnType<typeof vi.fn>;
        sendConciergeConfirmedToAgent: ReturnType<typeof vi.fn>;
        sendConciergeCancelledToAgent: ReturnType<typeof vi.fn>;
    };

    /** The plaintext confirm token is only ever in the email — never stored. */
    const emailedToken = (): string => {
        const calls = stubEmail.sendConciergeClientConfirm.mock.calls;
        return calls[calls.length - 1]?.[1]?.token as string;
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
    });

    describe('createBooking', () => {
        it('flips state to awaiting_inspector + emails inspector when reviewRequired=true', async () => {
            await seedFixture(testDb, { reviewRequired: true });
            const result = await svc.createBooking(baseParams());

            expect(result.status).toBe('awaiting_inspector');
            const insp = await testDb.select().from(schema.inspections)
                .where(eq(schema.inspections.id, result.inspectionId)).get();
            expect(insp?.conciergeStatus).toBe('awaiting_inspector');
            expect(insp?.status).toBe('scheduled');
            expect(insp?.tenantId).toBe(T1);
            expect(insp?.inspectorId).toBe(INSPECTOR);
            // No client token minted yet — inspector hasn't approved.
            const tokens = await testDb.select().from(schema.conciergeConfirmTokens).all();
            expect(tokens.length).toBe(0);
            expect(stubEmail.sendConciergeInspectorReview).toHaveBeenCalledTimes(1);
            expect(stubEmail.sendConciergeClientConfirm).not.toHaveBeenCalled();
        });

        it('flips state to awaiting_client + mints token + emails client when reviewRequired=false (default)', async () => {
            await seedFixture(testDb, { reviewRequired: false });
            const result = await svc.createBooking(baseParams());

            expect(result.status).toBe('awaiting_client');
            const insp = await testDb.select().from(schema.inspections)
                .where(eq(schema.inspections.id, result.inspectionId)).get();
            expect(insp?.conciergeStatus).toBe('awaiting_client');
            const tokens = await testDb.select().from(schema.conciergeConfirmTokens).all();
            expect(tokens.length).toBe(1);
            expect(tokens[0].inspectionId).toBe(result.inspectionId);
            expect(tokens[0].clientEmail).toBe('sarah@example.com');
            expect(tokens[0].confirmedAt).toBeNull();
            expect(stubEmail.sendConciergeClientConfirm).toHaveBeenCalledTimes(1);
            // Inspector NOT notified in auto-confirm mode (the per-tenant default).
            expect(stubEmail.sendConciergeInspectorReview).not.toHaveBeenCalled();
        });

        it('rejects when agent link is revoked', async () => {
            await seedFixture(testDb, { agentLinkStatus: 'revoked' });
            await expect(svc.createBooking(baseParams())).rejects.toThrow(/not linked|forbidden/i);
        });

        it('rejects when agent link is pending (not yet active)', async () => {
            await seedFixture(testDb, { agentLinkStatus: 'pending' });
            await expect(svc.createBooking(baseParams())).rejects.toThrow(/not linked|forbidden/i);
        });

        it('auto-binds the buyer_agent from agentTenantLinks.inspectorContactId reverse lookup (inspection_people — Task 13 dropped referredByAgentId)', async () => {
            await seedFixture(testDb, { reviewRequired: false });
            const result = await svc.createBooking(baseParams());
            const { PeopleService } = await import('../../../server/services/people.service');
            const buyerAgentContactId = await new PeopleService({ DB: {} as D1Database })
                .contactIdForRole(T1, result.inspectionId, 'buyer_agent');
            expect(buyerAgentContactId).toBe(CONTACT_AGENT);
        });

        it('rejects when inspector contact is not found in tenant', async () => {
            await seedFixture(testDb, { reviewRequired: false });
            await expect(svc.createBooking({ ...baseParams(), inspectorContactId: 'no-such-contact' }))
                .rejects.toThrow(/not found/i);
        });
    });

    describe('approveByInspector', () => {
        it('transitions awaiting_inspector → awaiting_client + mints token + emails client', async () => {
            await seedFixture(testDb, { reviewRequired: true });
            await seedRoleProfiles(testDb, T1, new Date(1));
            const created = await svc.createBooking(baseParams());

            // Task 9b (people-role-profiles) — approveByInspector resolves the
            // client-confirm recipient via PeopleService.getPrimaryClient
            // (inspection_people join) instead of the legacy
            // inspection.clientEmail column. createBooking itself now mirrors
            // the booking client into inspection_people (client role) — see
            // concierge-people.spec.ts — so no manual seeding is needed here.
            await svc.approveByInspector(created.inspectionId, T1);

            const insp = await testDb.select().from(schema.inspections)
                .where(eq(schema.inspections.id, created.inspectionId)).get();
            expect(insp?.conciergeStatus).toBe('awaiting_client');
            const tokens = await testDb.select().from(schema.conciergeConfirmTokens).all();
            expect(tokens.length).toBe(1);
            expect(stubEmail.sendConciergeClientConfirm).toHaveBeenCalledTimes(1);
        });

        it('rejects when inspection is not in awaiting_inspector state', async () => {
            await seedFixture(testDb, { reviewRequired: false });
            const created = await svc.createBooking(baseParams()); // awaiting_client
            await expect(svc.approveByInspector(created.inspectionId, T1)).rejects.toThrow(/not awaiting/i);
        });

        it('refuses cross-tenant approval (different tenantId)', async () => {
            await seedFixture(testDb, { reviewRequired: true });
            const created = await svc.createBooking(baseParams());
            const OTHER = '00000000-0000-0000-0000-0000000000ff';
            await expect(svc.approveByInspector(created.inspectionId, OTHER)).rejects.toThrow(/not found/i);
        });
    });

    describe('confirmByClient', () => {
        it('clears concierge_status, sets inspection.status = "confirmed", marks token used', async () => {
            await seedFixture(testDb, { reviewRequired: false });
            const created = await svc.createBooking(baseParams());
            const tok = emailedToken();

            const result = await svc.confirmByClient(tok);

            expect(result.inspectionId).toBe(created.inspectionId);
            const insp = await testDb.select().from(schema.inspections)
                .where(eq(schema.inspections.id, created.inspectionId)).get();
            expect(insp?.conciergeStatus).toBeNull();
            expect(insp?.status).toBe('confirmed');
            const after = await testDb.select().from(schema.conciergeConfirmTokens).all();
            expect(after[0].confirmedAt).toBeTruthy();
        });

        it('rejects expired token', async () => {
            await seedFixture(testDb, { reviewRequired: false });
            const created = await svc.createBooking(baseParams());
            await testDb.update(schema.conciergeConfirmTokens)
                .set({ expiresAt: new Date(Date.now() - 1000) })
                .where(eq(schema.conciergeConfirmTokens.inspectionId, created.inspectionId));
            await expect(svc.confirmByClient(emailedToken())).rejects.toThrow(/expired/i);
        });

        it('rejects already-confirmed token (single-use)', async () => {
            await seedFixture(testDb, { reviewRequired: false });
            await svc.createBooking(baseParams());
            const tok = emailedToken();
            await svc.confirmByClient(tok);
            await expect(svc.confirmByClient(tok)).rejects.toThrow(/already/i);
        });

        it('rejects unknown token', async () => {
            await seedFixture(testDb);
            await expect(svc.confirmByClient('does-not-exist')).rejects.toThrow(/not found/i);
        });

        it('emails the agent that the booking was confirmed', async () => {
            await seedFixture(testDb, { reviewRequired: false });
            await svc.createBooking(baseParams());
            await svc.confirmByClient(emailedToken());
            expect(stubEmail.sendConciergeConfirmedToAgent).toHaveBeenCalledTimes(1);
            // Agent's email is jane@realty.com (from seed users insert).
            expect(stubEmail.sendConciergeConfirmedToAgent.mock.calls[0]?.[0]).toBe('jane@realty.com');
        });
    });

    describe('resolveToken', () => {
        it('returns inspection summary + expired=false for a fresh token', async () => {
            await seedFixture(testDb, { reviewRequired: false });
            const created = await svc.createBooking(baseParams());

            const view = await svc.resolveToken(emailedToken());

            expect(view).not.toBeNull();
            expect(view?.expired).toBe(false);
            expect(view?.alreadyConfirmed).toBe(false);
            expect(view?.inspection.id).toBe(created.inspectionId);
            expect(view?.inspection.propertyAddress).toBe('1 Main St');
        });

        it('returns expired=true for past-TTL tokens', async () => {
            await seedFixture(testDb, { reviewRequired: false });
            const created = await svc.createBooking(baseParams());
            await testDb.update(schema.conciergeConfirmTokens)
                .set({ expiresAt: new Date(Date.now() - 1000) })
                .where(eq(schema.conciergeConfirmTokens.inspectionId, created.inspectionId));
            const view = await svc.resolveToken(emailedToken());
            expect(view?.expired).toBe(true);
        });

        it('returns alreadyConfirmed=true once redeemed', async () => {
            await seedFixture(testDb, { reviewRequired: false });
            await svc.createBooking(baseParams());
            const tok = emailedToken();
            await svc.confirmByClient(tok);
            const view = await svc.resolveToken(tok);
            expect(view?.alreadyConfirmed).toBe(true);
        });

        it('returns null for an unknown token', async () => {
            await seedFixture(testDb);
            const view = await svc.resolveToken('does-not-exist');
            expect(view).toBeNull();
        });
    });

    // ─── Track I-a — confirm-token hash-at-rest (tier-1) ──────────────────────
    describe('token hash-at-rest', () => {
        it('(a) createBooking stores hash, NOT plaintext (PK is a sentinel)', async () => {
            await seedFixture(testDb, { reviewRequired: false });
            await svc.createBooking(baseParams());
            const tok = emailedToken();
            const rows = await testDb.select().from(schema.conciergeConfirmTokens).all();
            expect(rows).toHaveLength(1);
            expect(rows[0].token).toMatch(/^x:/);          // sentinel
            expect(rows[0].token).not.toBe(tok);
            expect(rows[0].tokenHash).toBe(await hashToken(tok));
        });

        it('(b) presenting the emailed plaintext resolves via the hash path', async () => {
            await seedFixture(testDb, { reviewRequired: false });
            await svc.createBooking(baseParams());
            const view = await svc.resolveToken(emailedToken());
            expect(view).not.toBeNull();
        });

        it('(c) legacy plaintext row resolves AND is upgraded in place', async () => {
            await seedFixture(testDb, { reviewRequired: false });
            const created = await svc.createBooking(baseParams());
            // Simulate a pre-hash legacy row: plaintext PK, no hash.
            const legacyToken = 'legacy-concierge-confirm-token-1234567890';
            await testDb.insert(schema.conciergeConfirmTokens).values({
                token: legacyToken,
                inspectionId: created.inspectionId,
                tenantId: T1,
                clientEmail: 'legacy@x.com',
                expiresAt: new Date(Date.now() + 86_400_000),
                confirmedAt: null,
                createdAt: new Date(),
            });
            const view = await svc.resolveToken(legacyToken);
            expect(view).not.toBeNull();
            const upgraded = await testDb.select().from(schema.conciergeConfirmTokens)
                .where(eq(schema.conciergeConfirmTokens.tokenHash, await hashToken(legacyToken))).get();
            expect(upgraded).toBeTruthy();
            expect(upgraded?.token).toMatch(/^x:/);     // PK rewritten to sentinel
            expect(upgraded?.clientEmail).toBe('legacy@x.com');
        });

        it('(c2) legacy plaintext confirm is single-use (mark-used survives the lazy upgrade)', async () => {
            await seedFixture(testDb, { reviewRequired: false });
            const created = await svc.createBooking(baseParams());
            const legacyToken = 'legacy-concierge-confirm-token-replay-99';
            await testDb.insert(schema.conciergeConfirmTokens).values({
                token: legacyToken,
                inspectionId: created.inspectionId,
                tenantId: T1,
                clientEmail: 'legacy@x.com',
                expiresAt: new Date(Date.now() + 86_400_000),
                confirmedAt: null,
                createdAt: new Date(),
            });
            // First confirm succeeds; the lazy upgrade rewrites the PK to a
            // sentinel mid-flight — confirmedAt must land on the row anyway.
            await svc.confirmByClient(legacyToken);
            const upgraded = await testDb.select().from(schema.conciergeConfirmTokens)
                .where(eq(schema.conciergeConfirmTokens.tokenHash, await hashToken(legacyToken))).get();
            expect(upgraded?.confirmedAt).toBeTruthy();
            // Replay must be rejected.
            await expect(svc.confirmByClient(legacyToken)).rejects.toThrow(/already/i);
        });
    });
});
