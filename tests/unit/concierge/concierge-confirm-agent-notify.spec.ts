/**
 * Task 9c-X2 (people-role-profiles) — ConciergeService.confirmByClient's
 * agent-notify step must resolve the buyer's-agent contact via
 * inspection_people (buyer_agent role), not the legacy
 * inspections.referredByAgentId column (frozen cache, dropped Task 13).
 * Seeds the LEGACY referredByAgentId column NULL and only inspection_people
 * populated, so this fails against the old implementation (which reads only
 * insp.referredByAgentId off the inspections row and never emails the agent).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { ConciergeService } from '../../../server/services/concierge.service';
import { PeopleService } from '../../../server/services/people.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { EmailService } from '../../../server/services/email.service';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const T1     = '00000000-0000-0000-0000-0000000000b1';
const AGENT_CONTACT = 'contact-agent-confirm-notify';
const INSP   = 'insp-confirm-agent-notify-1';

const roleProfileId = (key: string) => `crp_${T1}_${key}`;

describe('ConciergeService.confirmByClient — buyer_agent notify sourcing (Task 9c-X2)', () => {
    let svc: ConciergeService;
    let db: BetterSQLite3Database<typeof schema>;
    let stubEmail: { sendConciergeConfirmedToAgent: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

        await db.insert(schema.tenants).values({
            id: T1, name: 'Acme', slug: 'acme-confirm-notify', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await seedRoleProfiles(db, T1, new Date(1));
        await db.insert(schema.contacts).values({
            id: AGENT_CONTACT, tenantId: T1, type: 'agent', name: 'Jane Agent',
            email: 'jane-agent@example.com', createdAt: new Date(),
        });

        // Legacy referredByAgentId is intentionally NULL — only
        // inspection_people carries the buyer_agent for this inspection.
        await db.insert(schema.inspections).values({
            id: INSP, tenantId: T1, propertyAddress: '1 Main St', referredByAgentId: null,
            date: '2026-06-15', status: 'scheduled', conciergeStatus: 'awaiting_client',
            paymentStatus: 'unpaid', price: 0, paymentRequired: false, agreementRequired: false,
            createdAt: new Date(),
        });
        const people = new PeopleService({ DB: {} as D1Database });
        await people.addPerson(T1, INSP, AGENT_CONTACT, roleProfileId('buyer_agent'));

        await db.insert(schema.conciergeConfirmTokens).values({
            token: 'plain-token-for-confirm-notify-1234567890',
            inspectionId: INSP,
            tenantId: T1,
            clientEmail: 'client@example.com',
            expiresAt: new Date(Date.now() + 86_400_000),
            confirmedAt: null,
            createdAt: new Date(),
        });

        stubEmail = { sendConciergeConfirmedToAgent: vi.fn().mockResolvedValue(undefined) };
        svc = new ConciergeService(
            {} as D1Database,
            stubEmail as unknown as EmailService,
            'https://acme.example.com',
        );
    });

    it('notifies the buyer_agent contact resolved via inspection_people', async () => {
        await svc.confirmByClient('plain-token-for-confirm-notify-1234567890');

        expect(stubEmail.sendConciergeConfirmedToAgent).toHaveBeenCalledTimes(1);
        expect(stubEmail.sendConciergeConfirmedToAgent.mock.calls[0]?.[0]).toBe('jane-agent@example.com');

        const insp = await db.select().from(schema.inspections).where(eq(schema.inspections.id, INSP)).get();
        expect(insp?.status).toBe('confirmed');
    });

    it('no buyer_agent at all — confirms the inspection without notifying (non-fatal, no legacy fallback)', async () => {
        await db.delete(schema.inspectionPeople).where(eq(schema.inspectionPeople.inspectionId, INSP));

        await svc.confirmByClient('plain-token-for-confirm-notify-1234567890');

        expect(stubEmail.sendConciergeConfirmedToAgent).not.toHaveBeenCalled();
        const insp = await db.select().from(schema.inspections).where(eq(schema.inspections.id, INSP)).get();
        expect(insp?.status).toBe('confirmed');
    });
});
