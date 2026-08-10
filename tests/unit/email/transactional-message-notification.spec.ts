/**
 * Task 9c (people-role-profiles) — TransactionalEmailMixin.sendMessageNotification
 * resolves the client's email/name from the inspection_people primary-client join
 * (PeopleService.getPrimaryClient).
 *
 * ⚠️ WHAT THIS SPEC USED TO CLAIM, AND WHY IT NO LONGER CAN. It was written while
 * `inspections` still carried denormalized `client_name` / `client_email` columns
 * that GDPR erasure never cleared. Each case seeded a divergent sentinel there and
 * asserted the sentinel did NOT reach the recipient. Those columns have since been
 * DROPPED — `server/lib/db/schema/inspection/core.ts` says so at the site where
 * they used to be declared: "the former denormalized clientContactId/clientName/
 * clientEmail/clientPhone columns were DROPPED (superseded by inspection_people)
 * — do not reintroduce them here". Drizzle silently discards unknown keys in
 * `.values()`, so the sentinels were never written, could never be read back, and
 * every `.not.toContain(sentinel)` was passing on a value with no way to exist.
 *
 * Those seeds and those assertions are gone. What remains is the half that still
 * has a subject: the recipient and the "from <name>" fallback come from
 * inspection_people, and once those rows are erased no client email is addressed
 * at all and the inspector sees a generic label.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EmailService } from '../../../server/services/email.service';
import { PeopleService } from '../../../server/services/people.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { createTestDb, setupSchema } from '../db';
import { asD1Db } from '../helpers/test-db';
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
        await seedRoleProfiles(asD1Db(testDb), TENANT, new Date(1));
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

    it('emails the client at the inspection_people primary-client\'s address', async () => {
        await testDb.insert(schema.contacts).values({
            id: CLIENT_CONTACT, tenantId: TENANT, type: 'client', name: 'Jane Client',
            email: 'jane@example.com', createdAt: new Date(),
        });
        await testDb.insert(schema.inspections).values({
            id: 'insp-1', tenantId: TENANT, inspectorId: INSPECTOR, propertyAddress: '1 Main St',
            date: '2026-06-01', status: 'confirmed', paymentStatus: 'unpaid', price: 0, createdAt: new Date(),
        });
        const people = new PeopleService({ DB: {} as D1Database });
        await people.addPerson(TENANT, 'insp-1', CLIENT_CONTACT, roleProfileId('client'));

        await svc.sendMessageNotification('client', 'insp-1', { body: 'Hello there' }, {
            db: {} as D1Database, baseUrl: 'https://app.acme.test',
        });

        expect(sent).toHaveLength(1);
        expect(sent[0]?.to).toEqual(['jane@example.com']);
    });

    it('inspector-recipient fromName fallback uses the inspection_people client\'s name', async () => {
        await testDb.insert(schema.contacts).values({
            id: CLIENT_CONTACT, tenantId: TENANT, type: 'client', name: 'Jane Client',
            email: 'jane@example.com', createdAt: new Date(),
        });
        await testDb.insert(schema.inspections).values({
            id: 'insp-2', tenantId: TENANT, inspectorId: INSPECTOR, propertyAddress: '2 Oak Ave',
            date: '2026-06-01', status: 'confirmed', paymentStatus: 'unpaid', price: 0, createdAt: new Date(),
        });
        const people = new PeopleService({ DB: {} as D1Database });
        await people.addPerson(TENANT, 'insp-2', CLIENT_CONTACT, roleProfileId('client'));

        await svc.sendMessageNotification('inspector', 'insp-2', { body: 'Hello there' }, {
            db: {} as D1Database, baseUrl: 'https://app.acme.test',
        });

        expect(sent).toHaveLength(1);
        expect(sent[0]?.html).toContain('Jane Client');
    });

    it('after GDPR erasure deletes the client\'s inspection_people + contacts rows, ' +
        'no client email is addressed at all', async () => {
        await testDb.insert(schema.inspections).values({
            id: 'insp-erased', tenantId: TENANT, inspectorId: INSPECTOR, propertyAddress: '3 Elm St',
            date: '2026-06-01', status: 'confirmed', paymentStatus: 'unpaid', price: 0, createdAt: new Date(),
        });
        // No inspection_people client row — simulates post-erasure state.

        await svc.sendMessageNotification('client', 'insp-erased', { body: 'Hello there' }, {
            db: {} as D1Database, baseUrl: 'https://app.acme.test',
        });

        expect(sent).toHaveLength(0);
    });

    it('inspector-recipient fromName falls back to a generic label once the client rows are erased', async () => {
        await testDb.insert(schema.inspections).values({
            id: 'insp-erased-2', tenantId: TENANT, inspectorId: INSPECTOR, propertyAddress: '4 Pine St',
            date: '2026-06-01', status: 'confirmed', paymentStatus: 'unpaid', price: 0, createdAt: new Date(),
        });

        await svc.sendMessageNotification('inspector', 'insp-erased-2', { body: 'Hello there' }, {
            db: {} as D1Database, baseUrl: 'https://app.acme.test',
        });

        expect(sent).toHaveLength(1);
        expect(sent[0]?.html).toContain('your client');
    });
});
