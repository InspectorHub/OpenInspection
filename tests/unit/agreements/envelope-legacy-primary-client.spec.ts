/**
 * Task 9b (people-role-profiles) — AgreementService.findOrCreate's
 * default-signer branch (no opts.signers) must resolve the client via
 * PeopleService.getPrimaryClient (inspection_people join) instead of the
 * legacy inspection.clientName/.clientEmail columns, which are being dropped
 * (Task 13). This spec seeds an inspection with the LEGACY client columns
 * NULL and only inspection_people populated, so it fails against the old
 * implementation (which reads only the legacy columns and falls back to an
 * empty-email 'Client' signer).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { AgreementService } from '../../../server/services/agreement.service';
import { PeopleService } from '../../../server/services/people.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000001';
const CLIENT = 'contact-client-1';
const INSP_ID = '550e8400-e29b-41d4-a716-446655440000';
const AGR_ID = '00000000-0000-0000-0000-000000000020';

const roleProfileId = (key: string) => `crp_${TENANT}_${key}`;

let db: BetterSQLite3Database<typeof schema>;
let svc: AgreementService;

describe('AgreementService.findOrCreate — default signer resolves via primary-client join (Task 9b)', () => {
    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

        await db.insert(schema.tenants).values({
            id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await db.insert(schema.agreements).values({
            id: AGR_ID, tenantId: TENANT, name: 'Standard Agreement', content: 'Agreement text...', version: 1, createdAt: new Date(),
        });
        await seedRoleProfiles(db, TENANT, new Date(1));
        await db.insert(schema.contacts).values({
            id: CLIENT, tenantId: TENANT, type: 'client', name: 'Jane Client',
            email: 'jane@example.com', phone: '+15551234567', createdAt: new Date(),
        });

        // Legacy client columns are intentionally NULL — only inspection_people
        // carries the primary client for this inspection.
        await db.insert(schema.inspections).values({
            id: INSP_ID, tenantId: TENANT, propertyAddress: '1 Main St',
            clientName: null, clientEmail: null, clientPhone: null,
            date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid', price: 50000,
            agreementRequired: true, paymentRequired: false, createdAt: new Date(),
        });

        svc = new AgreementService({} as D1Database, { jwtSecret: 'test-secret' });
    });

    it('no opts.signers — synthesizes the default client signer from the primary-client join', async () => {
        const people = new PeopleService({ DB: {} as D1Database });
        await people.addPerson(TENANT, INSP_ID, CLIENT, roleProfileId('client'));

        const r = await svc.findOrCreate(TENANT, INSP_ID);
        const signers = await db.select().from(schema.agreementSigners)
            .where(eq(schema.agreementSigners.requestId, r.requestId)).all();
        expect(signers).toHaveLength(1);
        expect(signers[0].role).toBe('client');
        expect(signers[0].name).toBe('Jane Client');
        expect(signers[0].email).toBe('jane@example.com');

        const envelope = await db.select().from(schema.agreementRequests)
            .where(eq(schema.agreementRequests.id, r.requestId)).get();
        expect(envelope?.clientEmail).toBe('jane@example.com');
        expect(envelope?.clientName).toBe('Jane Client');
    });

    it('opts.signers[0].email still takes precedence over the primary client', async () => {
        const people = new PeopleService({ DB: {} as D1Database });
        await people.addPerson(TENANT, INSP_ID, CLIENT, roleProfileId('client'));

        const r = await svc.findOrCreate(TENANT, INSP_ID, {
            signers: [{ name: 'Override Name', email: 'override@example.com', role: 'client' }],
        });
        const envelope = await db.select().from(schema.agreementRequests)
            .where(eq(schema.agreementRequests.id, r.requestId)).get();
        expect(envelope?.clientEmail).toBe('override@example.com');
        expect(envelope?.clientName).toBe('Override Name');
    });

    it('no primary client at all — falls back to an empty-email default signer (same as legacy no-clientEmail behavior)', async () => {
        const r = await svc.findOrCreate(TENANT, INSP_ID);
        const signers = await db.select().from(schema.agreementSigners)
            .where(eq(schema.agreementSigners.requestId, r.requestId)).all();
        expect(signers).toHaveLength(1);
        expect(signers[0].email).toBe('');
        expect(signers[0].name).toBe('Client');
    });
});
