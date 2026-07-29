/**
 * `addPerson` must say whether it actually seated anyone (IA-133).
 *
 * The add is idempotent on purpose — `onConflictDoNothing` against the unique
 * (inspection, contact, role) index is what makes a double-submit or a retry
 * safe. The defect was never the DB behavior; it was that "changed nothing"
 * and "granted access" came back from the API as the same 200, so the People
 * modal closed on both.
 *
 * That is only a cosmetic bug until you read the notice the modal shows while
 * you do it: it told operators that re-adding someone reissues a revoked report
 * link. It cannot — report tokens are unique per (inspection, recipient), so
 * there is no second row to mint. Verified in the browser against seeded data:
 * re-adding an agent whose access was revoked closed the modal as success and
 * left `inspection_access_tokens.revoked_at` untouched. The operator believed
 * they had restored access to a report and had not.
 *
 * So the assertion that matters is not "adding twice is safe" — it always was.
 * It is that the second call is DISTINGUISHABLE from the first.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { PeopleService } from '../../../server/services/people.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

const TENANT = '00000000-0000-0000-0000-0000000000d3';
const INSPECTION = 'i-people-idem';
const CONTACT = 'c-agent';
const AGENT_ROLE = 'crp-buyer-agent';

describe('PeopleService.addPerson — reports whether a seat was created', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let svc: PeopleService;

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        const { drizzle } = await import('drizzle-orm/d1');
        (drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        svc = new PeopleService({ DB: {} as D1Database });

        await testDb.insert(schema.tenants).values({
            id: TENANT, name: 'PeopleCo', slug: 'peopleco',
            status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await testDb.insert(schema.inspections).values({
            id: INSPECTION, tenantId: TENANT, propertyAddress: '1 Idem Way',
            date: '2030-01-01', status: 'scheduled', price: 0,
            agreementRequired: false, paymentRequired: false, createdAt: new Date(),
        });
        await testDb.insert(schema.contacts).values({
            id: CONTACT, tenantId: TENANT, type: 'agent', name: 'Rosa Lindqvist',
            email: 'rosa@example.com', createdAt: new Date(),
        } as never);
        await testDb.insert(schema.contactRoleProfiles).values({
            id: AGENT_ROLE, tenantId: TENANT, key: 'buyer_agent', label: "Buyer's Agent",
            kind: 'agent', isSystem: true, active: true, sortOrder: 1, createdAt: new Date(), updatedAt: new Date(),
        } as never);
    });

    async function seatCount() {
        const rows = await testDb.select({ id: schema.inspectionPeople.id })
            .from(schema.inspectionPeople)
            .where(and(
                eq(schema.inspectionPeople.tenantId, TENANT),
                eq(schema.inspectionPeople.inspectionId, INSPECTION),
            ));
        return rows.length;
    }

    it('reports added on the first call', async () => {
        const result = await svc.addPerson(TENANT, INSPECTION, CONTACT, AGENT_ROLE);
        expect(result.added).toBe(true);
        expect(await seatCount()).toBe(1);
    });

    it('reports NOT added when the contact already holds that role', async () => {
        // This is the regression. Before the fix both calls were indistinguishable
        // to every caller, which is what let the UI claim a grant that never
        // happened.
        await svc.addPerson(TENANT, INSPECTION, CONTACT, AGENT_ROLE);
        const second = await svc.addPerson(TENANT, INSPECTION, CONTACT, AGENT_ROLE);

        expect(second.added).toBe(false);
        // …and it is still idempotent: reporting the truth must not have cost us
        // the duplicate protection.
        expect(await seatCount()).toBe(1);
    });

    it('re-adding does not resurrect a revoked report link', async () => {
        // The specific false promise, asserted directly against the token row.
        await svc.addPerson(TENANT, INSPECTION, CONTACT, AGENT_ROLE);
        const revokedAt = new Date('2026-07-28T00:00:00Z');
        await testDb.insert(schema.inspectionAccessTokens).values({
            id: 'tok-1', tenantId: TENANT, inspectionId: INSPECTION,
            recipientEmail: 'rosa@example.com', role: 'buyer_agent',
            token: 'plain-1', createdAt: new Date(), revokedAt,
        } as never);

        await svc.addPerson(TENANT, INSPECTION, CONTACT, AGENT_ROLE);

        const tok = await testDb.select({ revokedAt: schema.inspectionAccessTokens.revokedAt })
            .from(schema.inspectionAccessTokens)
            .where(eq(schema.inspectionAccessTokens.id, 'tok-1'))
            .get();
        expect(tok?.revokedAt).toBeTruthy();
    });
});
