/**
 * Archive must have a way back (IA-120).
 *
 * `contacts.archivedAt` had a writer and no reader: the Archive button set it,
 * and every list query filtered it out unconditionally. There was no filter, no
 * detail route you could reach, and no endpoint that cleared it — so a control
 * whose own copy promises tidying ("Removes them from your list. Their
 * inspections and any report links they were sent are unaffected.") was in fact
 * a one-way door, recoverable only by re-creating the contact and losing its
 * history.
 *
 * The last test is the boundary that matters most: restoring a contact must NOT
 * hand back report access that archiving took away. Un-hiding a row and
 * re-granting someone a report are different decisions, and only one of them is
 * being asked for here.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { ContactService } from '../../../server/services/contact.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

const TENANT = '00000000-0000-0000-0000-0000000000c1';
const OTHER_TENANT = '00000000-0000-0000-0000-0000000000c2';

describe('ContactService — archive / restore round trip', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let svc: ContactService;

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        await setupSchema(fix.sqlite);
        const { drizzle } = await import('drizzle-orm/d1');
        (drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
        svc = new ContactService({} as D1Database);

        for (const [id, slug] of [[TENANT, 'c1'], [OTHER_TENANT, 'c2']] as const) {
            await db.insert(schema.tenants).values({
                id, slug, status: 'active',
                deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
            });
        }
        await db.insert(schema.contacts).values([
            { id: 'c-live', tenantId: TENANT, type: 'client', name: 'Live One', createdAt: new Date() },
            { id: 'c-archived', tenantId: TENANT, type: 'agent', name: 'Archived One', archivedAt: new Date(), createdAt: new Date() },
        ] as never);
    });

    const list = (archived?: 'exclude' | 'only') =>
        svc.listContacts(TENANT, { limit: 50, offset: 0, ...(archived ? { archived } : {}) });

    it('hides archived contacts from the default list', async () => {
        const rows = await list();
        expect(rows.map(r => r.id)).toEqual(['c-live']);
    });

    it('can list the archived ones — the read path that did not exist', async () => {
        const rows = await list('only');
        expect(rows.map(r => r.id)).toEqual(['c-archived']);
    });

    it('restores an archived contact back into the live list', async () => {
        const result = await svc.restoreContact('c-archived', TENANT);
        expect(result.restored).toBe(true);

        expect((await list()).map(r => r.id).sort()).toEqual(['c-archived', 'c-live']);
        expect(await list('only')).toEqual([]);
    });

    it('reports restored:false for a contact that was not archived', async () => {
        // Same discipline as addPerson: idempotent is fine, silent is not.
        const result = await svc.restoreContact('c-live', TENANT);
        expect(result.restored).toBe(false);
    });

    it('refuses to restore another tenant\'s contact', async () => {
        await db.insert(schema.contacts).values({
            id: 'c-foreign', tenantId: OTHER_TENANT, type: 'client',
            name: 'Someone Else', archivedAt: new Date(), createdAt: new Date(),
        } as never);

        await expect(svc.restoreContact('c-foreign', TENANT)).rejects.toThrow();

        const still = await db.select({ archivedAt: schema.contacts.archivedAt })
            .from(schema.contacts).where(eq(schema.contacts.id, 'c-foreign')).get();
        expect(still?.archivedAt).toBeTruthy();
    });

    it('does not reissue report access on restore', async () => {
        // Archiving can revoke live report links when the tenant has that policy
        // on. Restoring the contact row must not quietly undo that -- re-granting
        // a report is the People card's job, and doing it as a side effect of
        // un-hiding someone would be a grant nobody asked for.
        await db.insert(schema.inspectionAccessTokens).values({
            id: 'tok-archived', tenantId: TENANT, inspectionId: 'i-x',
            recipientEmail: 'archived@example.com', role: 'buyer_agent',
            token: 'plain', createdAt: new Date(), revokedAt: new Date(),
        } as never);

        await svc.restoreContact('c-archived', TENANT);

        const tok = await db.select({ revokedAt: schema.inspectionAccessTokens.revokedAt })
            .from(schema.inspectionAccessTokens)
            .where(eq(schema.inspectionAccessTokens.id, 'tok-archived')).get();
        expect(tok?.revokedAt).toBeTruthy();
    });
});
