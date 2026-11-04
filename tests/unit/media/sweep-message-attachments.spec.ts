/**
 * The orphan sweep and the files uploaded for an inspection's messages.
 *
 * An attachment is uploaded first and attached to a message when the message is sent, so an upload that is never sent is referenced by
 * nothing. The sweep records such a file the first time it sees it unreferenced and deletes it once the grace window has passed; a file
 * a message carries is never touched. Report PDFs share the `{tenant}/{inspection}/` prefix the sweep lists and are not its business.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { sweepOrphanedMedia } from '../../../server/lib/media/sweep-orphans';
import { ORPHAN_GRACE_MS } from '../../../server/lib/media/orphan-gc';

const TENANT = 't1';
const NOW = Date.parse('2026-08-22T00:00:00.000Z');
const SENT = `${TENANT}/messages/i1/sent.pdf`;
const UNSENT = `${TENANT}/messages/i1/unsent.pdf`;
const OTHER_INSPECTION = `${TENANT}/messages/i2/unsent.pdf`;
const REPORT_PDF = `${TENANT}/i1/reports/full-abc.pdf`;

function makeR2(objectsByPrefix: Record<string, string[]>) {
    return {
        list: vi.fn(async (opts: { prefix?: string }) => ({
            objects: (objectsByPrefix[opts.prefix ?? ''] ?? []).map((key) => ({ key })),
            truncated: false,
            cursor: undefined,
        })),
        delete: vi.fn(async (_key: string) => undefined),
    };
}

describe('sweepOrphanedMedia — message attachments', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    const sweep = (r2: ReturnType<typeof makeR2>, now: number) =>
        sweepOrphanedMedia({} as D1Database, r2 as unknown as R2Bucket, now, { limit: 10, afterInspectionId: null });
    const recorded = async () => (await testDb.select().from(schema.orphanedMedia)).map((r) => r.r2Key).sort();

    beforeEach(async () => {
        const setup = createTestDb();
        testDb = setup.db;
        await setupSchema(setup.sqlite);
        (mockDrizzle as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        await testDb.insert(schema.tenants).values([{ id: TENANT, slug: 'acme', createdAt: new Date(NOW) }]);
        await testDb.insert(schema.inspections).values(['i1', 'i2'].map((id) => ({
            id, tenantId: TENANT, propertyAddress: `${id} Main St`, date: '2026-08-20', createdAt: new Date(NOW),
        })));
        await testDb.insert(schema.inspectionMessages).values({
            id: 'm1', tenantId: TENANT, inspectionId: 'i1', contactId: 'c1', fromRole: 'client', body: 'see attached', createdAt: new Date(NOW),
            attachments: [{ id: 'sent', key: SENT, name: 'sent.pdf', size: 1, type: 'application/pdf', uploadedAt: NOW }],
        } as never);
    });

    it('records an unsent upload when first seen, deletes it only after the grace window, and never touches a sent one', async () => {
        const listing = { [`${TENANT}/messages/i1/`]: [SENT, UNSENT], [`${TENANT}/messages/i2/`]: [OTHER_INSPECTION] };
        const first = makeR2(listing);
        expect((await sweep(first, NOW)).reaped).toBe(0);
        expect(await recorded()).toEqual([OTHER_INSPECTION, UNSENT].sort());
        expect(first.delete).not.toHaveBeenCalled();

        const early = makeR2(listing);
        await sweep(early, NOW + ORPHAN_GRACE_MS - 1);
        expect(early.delete).not.toHaveBeenCalled();

        const late = makeR2(listing);
        const result = await sweep(late, NOW + ORPHAN_GRACE_MS);
        expect(result.reaped).toBe(2);
        const gone = late.delete.mock.calls.map((c) => c[0]).sort();
        expect(gone).toEqual([OTHER_INSPECTION, UNSENT].sort());
        expect(gone).not.toContain(SENT);
        expect(await recorded()).toEqual([]);
    });

    it('forgets an upload that a message picks up inside the grace window', async () => {
        const listing = { [`${TENANT}/messages/i1/`]: [UNSENT] };
        await sweep(makeR2(listing), NOW);
        expect(await recorded()).toEqual([UNSENT]);
        await testDb.insert(schema.inspectionMessages).values({
            id: 'm2', tenantId: TENANT, inspectionId: 'i1', contactId: 'c1', fromRole: 'inspector', body: 'now sent', createdAt: new Date(NOW),
            attachments: [{ id: 'unsent', key: UNSENT, name: 'unsent.pdf', size: 1, type: 'application/pdf', uploadedAt: NOW }],
        } as never);
        const later = makeR2(listing);
        await sweep(later, NOW + ORPHAN_GRACE_MS + 1);
        expect(later.delete).not.toHaveBeenCalled();
        expect(await recorded()).toEqual([]);
    });

    it('does not call a stored report PDF an orphan, though it sits under the inspection prefix the sweep lists', async () => {
        const r2 = makeR2({ [`${TENANT}/i1/`]: [REPORT_PDF] });
        await sweep(r2, NOW);
        // Control: the sweep did list that prefix, so the empty result is the exclusion and not an unlisted folder.
        expect(r2.list.mock.calls.some((c) => (c[0] as { prefix?: string }).prefix === `${TENANT}/i1/`)).toBe(true);
        expect(await recorded()).toEqual([]);
        const late = makeR2({ [`${TENANT}/i1/`]: [REPORT_PDF] });
        await sweep(late, NOW + ORPHAN_GRACE_MS * 2);
        expect(late.delete).not.toHaveBeenCalled();
    });
});
