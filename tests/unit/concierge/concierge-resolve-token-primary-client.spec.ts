/**
 * Task 9c (people-role-profiles) — ConciergeService.resolveToken() (backing
 * both GET /api/concierge/confirm-view and the /confirm/:token landing page
 * via api/concierge.ts, which is a pure passthrough of this method's output)
 * must source `inspection.clientName`/`.clientEmail` from the
 * inspection_people primary-client join (PeopleService.getPrimaryClient),
 * not the legacy inspections.client_name/_email columns (frozen cache,
 * dropped Task 13). Hard cutover, no legacy-column fallback.
 *
 * Seeds the LEGACY client columns NULL and only inspection_people populated,
 * so this fails against the old implementation (which reads only
 * insp.clientName/insp.clientEmail off the inspections row).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConciergeService } from '../../../server/services/concierge.service';
import { PeopleService } from '../../../server/services/people.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { EmailService } from '../../../server/services/email.service';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const T1 = '00000000-0000-0000-0000-0000000000c1';
const CLIENT = 'contact-client-concierge-resolve';
const INSP = 'insp-concierge-resolve-1';

const roleProfileId = (key: string) => `crp_${T1}_${key}`;

describe('ConciergeService.resolveToken — primary-client sourcing (Task 9c)', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let svc: ConciergeService;

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(db);

        await db.insert(schema.tenants).values({
            id: T1, name: 'Acme', slug: 'acme-resolve', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await seedRoleProfiles(db, T1, new Date(1));
        await db.insert(schema.contacts).values({
            id: CLIENT, tenantId: T1, type: 'client', name: 'Jane Client',
            email: 'jane@example.com', createdAt: new Date(),
        });

        // Legacy client columns are intentionally NULL — only
        // inspection_people carries the primary client for this inspection.
        await db.insert(schema.inspections).values({
            id: INSP, tenantId: T1, propertyAddress: '1 Main St',
            clientName: null, clientEmail: null,
            date: '2026-06-15', status: 'scheduled', paymentStatus: 'unpaid', price: 0,
            paymentRequired: false, agreementRequired: false, createdAt: new Date(),
        });
        const people = new PeopleService({ DB: {} as D1Database });
        await people.addPerson(T1, INSP, CLIENT, roleProfileId('client'));

        await db.insert(schema.conciergeConfirmTokens).values({
            token: 'plain-token-for-resolve-test-1234567890',
            inspectionId: INSP,
            tenantId: T1,
            clientEmail: 'jane@example.com',
            expiresAt: new Date(Date.now() + 86_400_000),
            confirmedAt: null,
            createdAt: new Date(),
        });

        svc = new ConciergeService({} as D1Database, {} as unknown as EmailService, 'https://acme.example.com');
    });

    it('resolves inspection.clientName/.clientEmail from the inspection_people primary-client join', async () => {
        const view = await svc.resolveToken('plain-token-for-resolve-test-1234567890');
        expect(view).not.toBeNull();
        expect(view?.inspection.clientName).toBe('Jane Client');
        expect(view?.inspection.clientEmail).toBe('jane@example.com');
    });

    it('no primary client at all — clientName/clientEmail are null (no legacy-column fallback)', async () => {
        const { eq } = await import('drizzle-orm');
        await db.delete(schema.inspectionPeople).where(eq(schema.inspectionPeople.inspectionId, INSP));

        const view = await svc.resolveToken('plain-token-for-resolve-test-1234567890');
        expect(view).not.toBeNull();
        expect(view?.inspection.clientName).toBeNull();
        expect(view?.inspection.clientEmail).toBeNull();
    });
});
