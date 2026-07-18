/**
 * Task 9c (people-role-profiles) — TransactionalEmailMixin.sendMessageNotification
 * must resolve the client's email/name from the inspection_people primary-client
 * join (PeopleService.getPrimaryClient), not the legacy inspections.client_email/
 * client_name columns, which survive GDPR erasure as a stale denormalized cache
 * and were leaking the erased subject's contact details (email recipient AND the
 * "from <name>" fallback shown to the inspector).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EmailService } from '../../../server/services/email.service';
import { PeopleService } from '../../../server/services/people.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

// sendMessageNotification dynamically imports 'drizzle-orm/d1' at call time —
// mock it the same way quota-threshold-notice.spec.ts does so both the static
// PeopleService import and the dynamic import resolve to the same in-memory
// SQLite Drizzle instance.
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000001';
const INSPECTOR = '00000000-0000-0000-0000-0000000000a1';
const CLIENT_CONTACT = 'contact-client-1';

const roleProfileId = (key: string) => `crp_${TENANT}_${key}`;

interface SentCall { to: string[]; subject: string; html: string }

describe('TransactionalEmailMixin.sendMessageNotification — client sourcing (Task 9c)', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let svc: EmailService;
    let sent: SentCall[];

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        await setupSchema(fixture.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);

        await testDb.insert(schema.tenants).values({
            id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await seedRoleProfiles(testDb, TENANT, new Date(1));
        await testDb.insert(schema.users).values({
            id: INSPECTOR, tenantId: TENANT, email: 'inspector@acme.com',
            passwordHash: 'x', name: 'Sam Inspector', role: 'inspector', createdAt: new Date(),
        });

        svc = new EmailService('test_api_key', 'no-reply@acme.test', 'Acme');
        sent = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (svc as any).sendEmail = vi.fn(async (to: string[], subject: string, html: string) => {
            sent.push({ to, subject, html });
        });
    });

    it('emails the client at the inspection_people primary-client\'s address, not the legacy inspections.client_email column', async () => {
        await testDb.insert(schema.contacts).values({
            id: CLIENT_CONTACT, tenantId: TENANT, type: 'client', name: 'Jane Client',
            email: 'jane@example.com', createdAt: new Date(),
        });
        await testDb.insert(schema.inspections).values({
            id: 'insp-1', tenantId: TENANT, inspectorId: INSPECTOR, propertyAddress: '1 Main St',
            // Legacy columns intentionally diverge from inspection_people — proves
            // the read is NOT falling back to them.
            clientName: 'STALE-LEGACY-NAME', clientEmail: 'stale-legacy@example.com',
            date: '2026-06-01', status: 'confirmed', paymentStatus: 'unpaid', price: 0, createdAt: new Date(),
        });
        const people = new PeopleService({ DB: {} as D1Database });
        await people.addPerson(TENANT, 'insp-1', CLIENT_CONTACT, roleProfileId('client'));

        await svc.sendMessageNotification('client', 'insp-1', { body: 'Hello there' }, {
            db: {} as D1Database, baseUrl: 'https://app.acme.test',
        });

        expect(sent).toHaveLength(1);
        expect(sent[0]?.to).toEqual(['jane@example.com']);
        expect(sent[0]?.to).not.toContain('stale-legacy@example.com');
    });

    it('inspector-recipient fromName fallback uses the inspection_people client\'s name, not the legacy inspections.client_name column', async () => {
        await testDb.insert(schema.contacts).values({
            id: CLIENT_CONTACT, tenantId: TENANT, type: 'client', name: 'Jane Client',
            email: 'jane@example.com', createdAt: new Date(),
        });
        await testDb.insert(schema.inspections).values({
            id: 'insp-2', tenantId: TENANT, inspectorId: INSPECTOR, propertyAddress: '2 Oak Ave',
            clientName: 'STALE-LEGACY-NAME', clientEmail: 'stale-legacy@example.com',
            date: '2026-06-01', status: 'confirmed', paymentStatus: 'unpaid', price: 0, createdAt: new Date(),
        });
        const people = new PeopleService({ DB: {} as D1Database });
        await people.addPerson(TENANT, 'insp-2', CLIENT_CONTACT, roleProfileId('client'));

        await svc.sendMessageNotification('inspector', 'insp-2', { body: 'Hello there' }, {
            db: {} as D1Database, baseUrl: 'https://app.acme.test',
        });

        expect(sent).toHaveLength(1);
        expect(sent[0]?.html).toContain('Jane Client');
        expect(sent[0]?.html).not.toContain('STALE-LEGACY-NAME');
    });

    it('ANTI-LEAK (Task 9c) — after GDPR erasure deletes the client\'s inspection_people + contacts rows, ' +
        'no email is sent to the stale legacy inspections.client_email column', async () => {
        await testDb.insert(schema.inspections).values({
            id: 'insp-erased', tenantId: TENANT, inspectorId: INSPECTOR, propertyAddress: '3 Elm St',
            // Mirrors erasure-orchestrator.ts: the legacy columns are a
            // denormalized cache the erasure job never touches — they retain
            // the subject's PII after contacts + inspection_people are deleted.
            clientName: 'LEAKED-PII-NAME', clientEmail: 'leaked-pii@example.com',
            date: '2026-06-01', status: 'confirmed', paymentStatus: 'unpaid', price: 0, createdAt: new Date(),
        });
        // No inspection_people client row — simulates post-erasure state.

        await svc.sendMessageNotification('client', 'insp-erased', { body: 'Hello there' }, {
            db: {} as D1Database, baseUrl: 'https://app.acme.test',
        });

        expect(sent).toHaveLength(0);
    });

    it('ANTI-LEAK (Task 9c) — inspector-recipient fromName falls back to a generic label, ' +
        'not the erased subject\'s stale legacy name', async () => {
        await testDb.insert(schema.inspections).values({
            id: 'insp-erased-2', tenantId: TENANT, inspectorId: INSPECTOR, propertyAddress: '4 Pine St',
            clientName: 'LEAKED-PII-NAME', clientEmail: 'leaked-pii@example.com',
            date: '2026-06-01', status: 'confirmed', paymentStatus: 'unpaid', price: 0, createdAt: new Date(),
        });

        await svc.sendMessageNotification('inspector', 'insp-erased-2', { body: 'Hello there' }, {
            db: {} as D1Database, baseUrl: 'https://app.acme.test',
        });

        expect(sent).toHaveLength(1);
        expect(sent[0]?.html).toContain('your client');
        expect(sent[0]?.html).not.toContain('LEAKED-PII-NAME');
    });
});
