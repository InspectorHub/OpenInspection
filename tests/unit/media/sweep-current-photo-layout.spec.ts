/**
 * The orphan sweep and the current storage layout.
 *
 * Photos are written under `{tenant}/inspections/{inspection}/photos/`. The sweep used to list only the older `{tenant}/{inspection}/`
 * prefix, so a photo uploaded and never placed (or removed from the report) in the current layout was never recorded and never freed.
 * It now reads the photos folder too, and ONLY that folder: its parent also holds videos, documents, agreement files and Word exports,
 * none of which the live set knows about.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';

import { lazyD1 } from '../helpers/d1-binding';
const testD1 = lazyD1();
import { sweepOrphanedMedia } from '../../../server/lib/media/sweep-orphans';
import { ORPHAN_GRACE_MS } from '../../../server/lib/media/orphan-gc';

const T = 't1';
const I = 'i1';
const NOW = Date.parse('2026-11-04T00:00:00.000Z');
const PHOTOS = `${T}/inspections/${I}/photos/`;
const PLACED = `${PHOTOS}placed.jpg`;
const ANNOTATED = `${PHOTOS}placed.annotated.png`;
const FROZEN_ONLY = `${PHOTOS}frozen-only.jpg`;
const STRAY = `${PHOTOS}stray.jpg`;
const VIDEO = `${T}/inspections/${I}/videos/clip.mp4`;
const DOCUMENT = `${T}/inspections/${I}/documents/d1-contract.pdf`;
const AGREEMENT = `${T}/inspections/${I}/agreements/e1/signed.pdf`;
const EXPORT = `${T}/inspections/${I}/exports/x1.docx`;

function makeR2(byPrefix: Record<string, string[]>) {
    return {
        list: vi.fn(async (opts: { prefix?: string }) => ({
            objects: (byPrefix[opts.prefix ?? ''] ?? []).map((key) => ({ key })),
            truncated: false,
            cursor: undefined,
        })),
        delete: vi.fn(async (_key: string) => undefined),
    };
}

describe('sweepOrphanedMedia - current photo layout', () => {
    let db: BetterSQLite3Database<typeof schema>;
    const sweep = (r2: ReturnType<typeof makeR2>, now: number) =>
        sweepOrphanedMedia(testD1.binding, r2 as unknown as R2Bucket, now, { limit: 10, afterInspectionId: null });
    const recorded = async () => (await db.select().from(schema.orphanedMedia)).map((r) => r.r2Key).sort();
    // The folder as the bucket holds it: everything the current layout writes for this inspection, listed by exact prefix.
    const bucket = () => makeR2({
        [PHOTOS]: [PLACED, ANNOTATED, FROZEN_ONLY, STRAY],
        [`${T}/inspections/${I}/`]: [PLACED, ANNOTATED, FROZEN_ONLY, STRAY, VIDEO, DOCUMENT, AGREEMENT, EXPORT],
    });

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db;
        await setupSchema(setup.sqlite);
        testD1.use(db);
        await db.insert(schema.tenants).values([{ id: T, slug: 'acme', createdAt: new Date(NOW) }]);
        await db.insert(schema.inspections).values({ id: I, tenantId: T, propertyAddress: '1 Main', date: '2026-11-01', createdAt: new Date(NOW) });
        await db.insert(schema.inspectionResults).values({
            id: 'r1', tenantId: T, inspectionId: I, lastSyncedAt: new Date(NOW),
            data: { 'sec:item': { photos: [{ key: PLACED, annotatedKey: ANNOTATED }] } },
        });
        // A published version shows one more photo that the working copy no longer has.
        await db.insert(schema.reportVersions).values({
            id: 'v1', tenantId: T, inspectionId: I, versionNumber: 1, publishedAt: new Date(NOW), publishedBy: 'u',
            snapshotJson: JSON.stringify({ data: { 'sec:item': { photos: [{ key: FROZEN_ONLY }] } }, units: [], inspection: {} }),
        });
    });

    it('records only the photo nothing shows, deletes it after the grace window, and keeps placed, annotated and published-version photos', async () => {
        const first = bucket();
        expect((await sweep(first, NOW)).reaped).toBe(0);
        expect(await recorded()).toEqual([STRAY]);
        expect(first.delete).not.toHaveBeenCalled();

        const early = bucket();
        await sweep(early, NOW + ORPHAN_GRACE_MS - 1);
        expect(early.delete).not.toHaveBeenCalled();

        const late = bucket();
        expect((await sweep(late, NOW + ORPHAN_GRACE_MS)).reaped).toBe(1);
        expect(late.delete.mock.calls.map((c) => c[0])).toEqual([STRAY]);
        expect(await recorded()).toEqual([]);
    });

    it('never lists, records or deletes the videos, documents, agreement files and exports that share the inspection folder', async () => {
        const r2 = bucket();
        await sweep(r2, NOW);
        const late = bucket();
        await sweep(late, NOW + ORPHAN_GRACE_MS * 2);
        // The photos folder was listed (control: the empty result below is the choice of prefix, not an unlisted folder) and its parent never was.
        const listed = late.list.mock.calls.map((c) => (c[0] as { prefix?: string }).prefix);
        expect(listed).toContain(PHOTOS);
        expect(listed).not.toContain(`${T}/inspections/${I}/`);
        const gone = late.delete.mock.calls.map((c) => c[0]);
        for (const kept of [VIDEO, DOCUMENT, AGREEMENT, EXPORT]) expect(gone).not.toContain(kept);
        expect(await recorded()).not.toEqual(expect.arrayContaining([VIDEO]));
    });

    it('keeps the cropped file of a photo that was cropped and then annotated', async () => {
        const original = `${PHOTOS}both.jpg`;
        const cropped = `${PHOTOS}both.cropped.jpg`;
        const annotated = `${PHOTOS}both.annotated.png`;
        await db.update(schema.inspectionResults)
            .set({ data: { 'sec:item': { photos: [{ key: original, croppedKey: cropped, annotatedKey: annotated }] } } })
            .where(eq(schema.inspectionResults.inspectionId, I));
        const listing = { [PHOTOS]: [original, cropped, annotated] };
        await sweep(makeR2(listing), NOW);
        const late = makeR2(listing);
        await sweep(late, NOW + ORPHAN_GRACE_MS * 2);
        // Control: the sweep listed the folder and ran, so an empty delete list is the live set and not a sweep that did nothing.
        expect(late.list.mock.calls.some((c) => (c[0] as { prefix?: string }).prefix === PHOTOS)).toBe(true);
        expect(late.delete).not.toHaveBeenCalled();
        expect(await recorded()).toEqual([]);
    });

    describe('call budget', () => {
        const IDS = ['i2', 'i3', 'i4', 'i5', 'i6'];
        beforeEach(async () => {
            await db.insert(schema.inspections).values(IDS.map((id) => ({
                id, tenantId: T, propertyAddress: `${id} Main St`, date: '2026-11-01', createdAt: new Date(NOW),
            })));
        });

        it('stops after the inspection that reaches the budget, hands back where to resume, and covers every inspection exactly once', async () => {
            const r2 = makeR2({});
            const examined: string[] = [];
            let cursor: string | null = null;
            let passes = 0;
            do {
                const before = r2.list.mock.calls.length;
                const out: { nextCursor: string | null } = await sweepOrphanedMedia(testD1.binding, r2 as unknown as R2Bucket, NOW, {
                    limit: 100, afterInspectionId: cursor, callBudget: 8,
                });
                for (const c of r2.list.mock.calls.slice(before)) {
                    const prefix = (c[0] as { prefix: string }).prefix;
                    const m = /^t1\/(i\d)\/$/.exec(prefix);
                    if (m) examined.push(m[1]!);
                }
                cursor = out.nextCursor;
                passes++;
            } while (cursor !== null && passes < 20);
            expect(passes, 'a budget of 8 cannot cover six inspections in one pass').toBeGreaterThan(1);
            expect(cursor).toBeNull();
            expect([...examined].sort()).toEqual(['i1', ...IDS].sort());
        });

        it('always examines at least one inspection, even with a budget that is already spent', async () => {
            const r2 = makeR2({});
            const out = await sweepOrphanedMedia(testD1.binding, r2 as unknown as R2Bucket, NOW, { limit: 100, afterInspectionId: null, callBudget: 1 });
            expect(out.nextCursor).toBe('i1');
            expect(r2.list.mock.calls.some((c) => (c[0] as { prefix?: string }).prefix === `${T}/i1/`)).toBe(true);
        });
    });

    it('still reaches a photo of the older layout through the older prefix', async () => {
        const legacyStray = `${T}/${I}/stray-old.jpg`;
        const listing = { [`${T}/${I}/`]: [legacyStray] };
        await sweep(makeR2(listing), NOW);
        expect(await recorded()).toEqual([legacyStray]);
    });
});
