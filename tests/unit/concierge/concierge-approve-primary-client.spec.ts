/**
 * Task 9b (people-role-profiles) — ConciergeService.approveByInspector must
 * resolve the client-confirm-email recipient via PeopleService.getPrimaryClient
 * (inspection_people join) instead of the legacy inspection.clientEmail
 * column, which is being dropped (Task 13). This spec seeds an inspection
 * with the LEGACY client columns NULL and only inspection_people populated,
 * so it fails against the old implementation (which reads only
 * inspection.clientEmail and throws BadRequest "no client email on file").
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

const TENANT = '00000000-0000-0000-0000-000000000001';
const CLIENT = 'contact-client-1';
const INSP_ID = '550e8400-e29b-41d4-a716-446655440000';

const roleProfileId = (key: string) => `crp_${TENANT}_${key}`;

describe('ConciergeService.approveByInspector — primary-client resolution (Task 9b)', () => {
    let svc: ConciergeService;
    let db: BetterSQLite3Database<typeof schema>;
    let stubEmail: { sendConciergeClientConfirm: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

        await db.insert(schema.tenants).values({
            id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await seedRoleProfiles(db, TENANT, new Date(1));
        await db.insert(schema.contacts).values({
            id: CLIENT, tenantId: TENANT, type: 'client', name: 'Jane Client',
            email: 'jane@example.com', phone: null, createdAt: new Date(),
        });

        // Legacy client columns are intentionally NULL — only inspection_people
        // carries the primary client for this inspection.
        await db.insert(schema.inspections).values({
            id: INSP_ID, tenantId: TENANT, propertyAddress: '1 Main St',
            clientName: null, clientEmail: null, clientPhone: null,
            date: '2026-06-01', status: 'scheduled', paymentStatus: 'unpaid', price: 0,
            agreementRequired: false, paymentRequired: false, conciergeStatus: 'awaiting_inspector',
            createdAt: new Date(),
        });

        const people = new PeopleService({ DB: {} as D1Database });
        await people.addPerson(TENANT, INSP_ID, CLIENT, roleProfileId('client'));

        stubEmail = { sendConciergeClientConfirm: vi.fn().mockResolvedValue(undefined) };
        svc = new ConciergeService({} as D1Database, stubEmail as unknown as EmailService, 'https://acme.example.com');
    });

    it('mints the client-confirm token and emails the primary client resolved via PeopleService', async () => {
        await svc.approveByInspector(INSP_ID, TENANT);

        const insp = await db.select().from(schema.inspections).where(eq(schema.inspections.id, INSP_ID)).get();
        expect(insp?.conciergeStatus).toBe('awaiting_client');

        const tokens = await db.select().from(schema.conciergeConfirmTokens).all();
        expect(tokens).toHaveLength(1);
        expect(tokens[0].clientEmail).toBe('jane@example.com');
        expect(stubEmail.sendConciergeClientConfirm).toHaveBeenCalledTimes(1);
        expect(stubEmail.sendConciergeClientConfirm.mock.calls[0][0]).toBe('jane@example.com');
    });

    it('no primary client at all — rejects with BadRequest (same as legacy no-clientEmail behavior)', async () => {
        await db.delete(schema.inspectionPeople).where(eq(schema.inspectionPeople.inspectionId, INSP_ID));
        await expect(svc.approveByInspector(INSP_ID, TENANT)).rejects.toThrow(/no client email/i);
        expect(stubEmail.sendConciergeClientConfirm).not.toHaveBeenCalled();
    });
});
