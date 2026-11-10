/**
 * "Copy as a new report" (service): what a copy of a signed, published, paid report carries and, above all,
 * what it must not. Runs against a real in-memory database and an in-memory bucket that holds bytes.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { Database as SqliteDatabase } from 'better-sqlite3';
import { InspectionCopyReportService, type CopyReportOptions } from '../../../server/services/inspection/inspection-copy-report.service';
import { getTableColumns } from 'drizzle-orm';
import { cloneInsertValues } from '../../../server/services/inspection/clone-columns';
import { PlanQuotaGuard } from '../../../server/features/plan-quota/guard';
import { PeopleService } from '../../../server/services/people.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { createTestDb, setupSchema } from '../db';
import { d1For } from '../helpers/d1-binding';
import { asD1Db } from '../helpers/test-db';
import { makeMemoryR2, type MemoryR2 } from '../helpers/memory-r2';
import * as schema from '../../../server/lib/db/schema';

const TENANT = 't-acme';
const OTHER_TENANT = 't-other';
const SRC = 'src-insp';
const PRIMARY = 'src-report';
const srcPhoto = (name: string) => `${TENANT}/inspections/${SRC}/photos/${name}`;
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const K = (section: string, item: string) => `_default:${section}:${item}`;

const TEMPLATE = { sections: [
    { id: 's1', title: 'Roof', items: [{ id: 'i1', label: 'Shingles' }, { id: 'i2', label: 'Flashing' }, { id: 'i3', label: 'Gutters' }] },
    { id: 's2', title: 'Attic', items: [{ id: 'i4', label: 'Insulation' }] },
] };

/** Every string that describes the SOURCE's sign-off, identity or tokens. None may appear in anything the copy owns. */
const CANARIES = ['CANARY-VERIFY-TOKEN', 'CANARY-HASH', 'CANARY-AGREEMENT-TOKEN', 'CANARY-SIGNER-TOKEN', 'CANARY-ESIGN', 'CANARY-SIGNATURE', 'CANARY-COVER', 'CANARY-UNLOCK', 'CANARY-YDOC', 'CANARY-FOLLOWUP', 'CANARY-REPAIR', 'CANARY-FUTURE', 'CANARY-ORIGINAL', 'CANARY-ESTIMATE', 'CANARY-POSTER', 'CANARY-STREAM', 'CANARY-NESTED'];

const SOURCE_DATA = {
    [K('s1', 'i1')]: {
        rating: 'defect', notes: 'Cracked shingles', value: 'asphalt', attributes: { pitch: '6/12' },
        recommendation: 'CANARY-REPAIR-text',
        tabs: {
            information: [{ cannedId: 'c1', included: true, canaryFutureField: 'CANARY-NESTED' }],
            limitations: [{ cannedId: 'l1', included: true, comment: 'Not accessible' }],
            defects: [{ cannedId: 'd1', included: true, comment: 'Lifted tabs', recommendationId: 'CANARY-REPAIR-id', estimateLow: 'CANARY-ESTIMATE', canaryFutureField: 'CANARY-NESTED', photos: [{ key: srcPhoto('d1.jpg'), streamUid: 'CANARY-STREAM' }] }],
        },
        customComments: { defects: [{ id: 'cc1', title: 'Ponding', comment: 'Water at the valley', included: true, estimateHigh: 'CANARY-ESTIMATE', canaryFutureField: 'CANARY-NESTED', photos: [{ key: srcPhoto('cc1.jpg'), posterKey: 'CANARY-POSTER' }] }] },
        photos: [{ key: srcPhoto('p1.jpg'), croppedKey: srcPhoto('p1.cropped.jpg'), crop: { aspect: '4:3', orientation: 'landscape', x: 1, y: 2, width: 3, height: 4 }, mediaId: 'p1', annotationsJson: '[]', posterKey: 'CANARY-POSTER', streamUid: 'CANARY-STREAM', canaryFutureField: 'CANARY-NESTED' }, { key: srcPhoto('v.mp4'), mediaType: 'video', provider: 'r2' }],
        original: { rating: 'ok', notes: 'CANARY-ORIGINAL', photos: [] },
        followupStatus: 'CANARY-FOLLOWUP', followupNotes: 'CANARY-FOLLOWUP-notes',
        recommendations: [{ recommendationId: 'CANARY-REPAIR-rec', summarySnapshot: 'CANARY-REPAIR', contractorTypeSnapshot: null, attachedAt: 1 }],
        canaryFutureField: 'CANARY-FUTURE',
    },
    [K('s1', 'i2')]: { rating: 'ok', notes: 'Flashing fine' },
    [K('s2', 'i4')]: { rating: 'monitor', notes: 'Thin insulation' },
    // A finding whose place the template does not have, and two meta keys that are not findings at all.
    [K('s2', 'removed')]: { rating: 'defect', notes: 'Old item' },
    _inspector_signature: 'CANARY-SIGNATURE',
    _report_signoff: { signedBy: 'CANARY-SIGNATURE' },
};

/** The database column a property of the `inspections` table is stored in. */
const columnNameOf = (prop: string): string => (getTableColumns(schema.inspections) as Record<string, { name: string }>)[prop]!.name;

const SAME: CopyReportOptions = { scope: 'rating_notes', property: 'same', photos: false };

describe('InspectionCopyReportService', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let sqlite: SqliteDatabase;
    let binding: D1Database;
    let r2: MemoryR2;
    let svc: InspectionCopyReportService;

    const resultsOf = async (inspectionId: string) => (await testDb.select().from(schema.inspectionResults).where(eq(schema.inspectionResults.inspectionId, inspectionId)).get())!;
    const inspectionOf = async (id: string) => (await testDb.select().from(schema.inspections).where(eq(schema.inspections.id, id)).get())!;
    const count = (table: string, where = '1=1') => (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get() as { n: number }).n;
    const signoffTables = ['report_versions', 'agreement_requests', 'agreement_signers', 'esign_audit_logs', 'signing_keys'];
    const signoffCounts = () => Object.fromEntries(signoffTables.map((t) => [t, count(t)]));

    /** Every row in the database that mentions `id`, as text: what the copy owns, whichever table it landed in. */
    function everythingMentioning(id: string): string {
        const tables = sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all() as Array<{ name: string }>;
        const hits: string[] = [];
        for (const { name } of tables) {
            for (const row of sqlite.prepare(`SELECT * FROM "${name}"`).all() as Array<Record<string, unknown>>) {
                // JSON.stringify calls Buffer#toJSON first, so the replacer sees `{ type: 'Buffer', data: [...] }`, never the Buffer.
                const text = JSON.stringify(row, (_k, v) => {
                    if (typeof v === 'bigint') return String(v);
                    if (v && typeof v === 'object' && (v as { type?: string }).type === 'Buffer' && Array.isArray((v as { data?: number[] }).data)) return `blob:${Buffer.from((v as { data: number[] }).data).toString('latin1')}`;
                    return v;
                });
                if (text.includes(id)) hits.push(`${name}: ${text}`);
            }
        }
        return hits.join('\n');
    }

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        sqlite = fixture.sqlite;
        await setupSchema(sqlite);
        binding = d1For(testDb);
        r2 = makeMemoryR2();
        svc = new InspectionCopyReportService(binding, r2.bucket);

        await testDb.insert(schema.tenants).values([
            { id: TENANT, slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
            { id: OTHER_TENANT, slug: 'other', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        ]);
        // The source: completed, published, paid, signed, with a cover, an unlock record and every kind of token.
        await testDb.insert(schema.inspections).values({
            id: SRC, tenantId: TENANT, propertyAddress: '1 Main St', addressStreet: '1 Main St', addressCity: 'Austin', addressState: 'TX', addressZip: '78701',
            date: '2026-06-01', status: 'completed', reportStatus: 'published', paymentStatus: 'paid', price: 45000, paymentRequired: true, agreementRequired: true,
            yearBuilt: 1987, sqft: 2100, referenceNumber: 'REF-1', closingDate: '2026-07-01',
            templateSnapshot: TEMPLATE, templateSnapshotVersion: 2, confirmedAt: new Date(5), unlockedAt: new Date(6), unlockedBy: 'CANARY-UNLOCK',
            coverPhotoId: 'cover-1', coverImageKey: 'CANARY-COVER', autoSignOnPublish: true, discountAmount: 500, createdAt: new Date(1),
        } as never);
        await testDb.insert(schema.reports).values({ id: PRIMARY, tenantId: TENANT, inspectionId: SRC, kind: 'primary', title: 'Home', status: 'published', publishedAt: new Date(7), createdAt: new Date(1) });
        await testDb.insert(schema.inspectionResults).values({
            id: 'src-results', tenantId: TENANT, inspectionId: SRC, reportId: PRIMARY, data: SOURCE_DATA as never,
            ydocState: Buffer.from('CANARY-YDOC-state-bytes'), lastSyncedAt: new Date(8), ratingSystemId: 'rs-1', ratingSystemSnapshot: { levels: [{ id: 'defect' }] } as never,
        });
        await testDb.insert(schema.reportVersions).values({
            id: 'rv-1', tenantId: TENANT, inspectionId: SRC, versionNumber: 1, snapshotJson: '{"data":{}}', contentHash: 'CANARY-HASH', signature: 'CANARY-SIGNATURE',
            keyFingerprint: 'fp-1', verificationToken: 'CANARY-VERIFY-TOKEN', publishedAt: new Date(7), publishedBy: 'user-1', createdAt: new Date(7),
        });
        await testDb.insert(schema.agreements).values({ id: 'ag-1', tenantId: TENANT, name: 'Pre-inspection agreement', content: 'terms', createdAt: new Date(1) });
        await testDb.insert(schema.agreementRequests).values({
            id: 'ar-1', tenantId: TENANT, inspectionId: SRC, agreementId: 'ag-1', clientEmail: 'client@example.com', status: 'signed', signedAt: new Date(9),
            verificationToken: 'CANARY-AGREEMENT-TOKEN', contentHash: 'CANARY-HASH', createdAt: new Date(1),
        } as never);
        await testDb.insert(schema.agreementSigners).values({
            id: 'as-1', tenantId: TENANT, requestId: 'ar-1', name: 'Client', email: 'client@example.com', tokenHash: 'CANARY-SIGNER-TOKEN', status: 'signed', signatureBase64: 'CANARY-SIGNATURE', createdAt: new Date(1),
        } as never);
        await testDb.insert(schema.signingKeys).values({ id: 'sk-1', tenantId: TENANT, publicKey: 'pub', privateKeyEnc: 'enc', privateKeyIv: 'iv', fingerprint: 'fp-1', createdAt: new Date(1) });
        await testDb.insert(schema.esignAuditLogs).values({
            id: 'el-1', tenantId: TENANT, requestId: 'ar-1', event: 'agreement.signed', payloadJson: '{"note":"CANARY-ESIGN"}', hash: 'CANARY-HASH', signature: 'CANARY-SIGNATURE', keyFingerprint: 'fp-1', createdAt: new Date(9),
        });
        await testDb.insert(schema.tags).values({ id: 'tag-1', tenantId: TENANT, name: 'Urgent', createdAt: new Date(1) });
        await testDb.insert(schema.inspectionItemTagLinks).values([
            { inspectionId: SRC, itemId: K('s1', 'i1'), tagId: 'tag-1', tenantId: TENANT, createdAt: new Date(1) },
            { inspectionId: SRC, itemId: K('s2', 'removed'), tagId: 'tag-1', tenantId: TENANT, createdAt: new Date(1) },
        ]);
        r2.seed(srcPhoto('p1.jpg'), Uint8Array.from({ length: 2048 }, (_, i) => i % 251));
        r2.seed(srcPhoto('p1.cropped.jpg'), Uint8Array.from({ length: 1024 }, (_, i) => (i * 3) % 251));
        r2.seed(srcPhoto('d1.jpg'), 'defect photo');
        r2.seed(srcPhoto('cc1.jpg'), 'custom comment photo');
    });

    describe('what a copy of a signed, published, paid source must not carry', () => {
        it('carries none of its sign-off, tokens, versions, agreements, cover or unlock: no row and no byte of it', async () => {
            const before = signoffCounts();
            expect(before).toEqual({ report_versions: 1, agreement_requests: 1, agreement_signers: 1, esign_audit_logs: 1, signing_keys: 1 });

            const { inspection } = await svc.copyReport(TENANT, SRC, { ...SAME, scope: 'all', photos: true });

            // No sign-off row came into being, for any scope, with photos on.
            expect(signoffCounts()).toEqual(before);
            expect(count('report_versions', `inspection_id = '${inspection.id}'`)).toBe(0);
            expect(count('agreement_requests', `inspection_id = '${inspection.id}'`)).toBe(0);
            // Nothing the copy owns, in ANY table, mentions a canary.
            const owned = everythingMentioning(inspection.id);
            expect(owned.length).toBeGreaterThan(0);
            for (const canary of CANARIES) expect(owned, canary).not.toContain(canary);
            // The same holds for what it stored in the bucket.
            for (const key of r2.keys(`${TENANT}/inspections/${inspection.id}/`)) {
                expect(new TextDecoder('latin1').decode(r2.store.get(key)!.bytes)).not.toContain('CANARY');
            }
        });

        it('the new row equals what the booking clone allow-list yields, and every other column starts at its default', async () => {
            const { inspection } = await svc.copyReport(TENANT, SRC, SAME);
            const source = await inspectionOf(SRC);
            const row = await inspectionOf(inspection.id);
            expect(row).toMatchObject(cloneInsertValues(source, { id: row.id, tenantId: TENANT, date: row.date, createdAt: row.createdAt }));
            expect(row).toMatchObject({
                status: 'requested', paymentStatus: 'unpaid', reportStatus: 'in_progress', unlockedAt: null, unlockedBy: null, coverPhotoId: null, coverImageKey: null,
                confirmedAt: null, discountAmount: null, autoSignOnPublish: false, sourceInspectionId: null, rootInspectionId: null,
            });
            // The requirements of the job come across as requirements, not as state: the client signs and pays again.
            expect(row).toMatchObject({ paymentRequired: true, agreementRequired: true, price: 45000 });
            expect(row.id).not.toBe(SRC);
        });

        it('the editor document starts a history of its own: no source bytes, a report row of its own', async () => {
            const { inspection } = await svc.copyReport(TENANT, SRC, { ...SAME, scope: 'all' });
            const copy = await resultsOf(inspection.id);
            const source = await resultsOf(SRC);
            expect(copy.ydocState).toBeNull();
            expect(Buffer.from(source.ydocState!).toString()).toContain('CANARY-YDOC');
            expect(copy.reportId).toBeTruthy();
            expect(copy.reportId).not.toBe(PRIMARY);
            expect(copy.id).not.toBe(source.id);
            const report = await testDb.select().from(schema.reports).where(eq(schema.reports.id, copy.reportId!)).get();
            expect(report).toMatchObject({ inspectionId: inspection.id, kind: 'primary', status: 'in_progress', publishedAt: null });
        });

        it('the source is not changed by the copy: row, results, bytes and objects', async () => {
            const rowBefore = JSON.stringify(await inspectionOf(SRC));
            const dataBefore = JSON.stringify((await resultsOf(SRC)).data);
            const objectsBefore = new Map([...r2.store].map(([k, o]) => [k, sha(o.bytes)]));
            await svc.copyReport(TENANT, SRC, { ...SAME, scope: 'all', photos: true });
            expect(JSON.stringify(await inspectionOf(SRC))).toBe(rowBefore);
            expect(JSON.stringify((await resultsOf(SRC)).data)).toBe(dataBefore);
            for (const [k, h] of objectsBefore) expect(sha(r2.store.get(k)!.bytes)).toBe(h);
            expect(r2.log.filter((l) => /^(put|delete):/.test(l) && l.includes(`/inspections/${SRC}/`))).toEqual([]);
        });
    });

    describe('scopes', () => {
        it('rating copies only the rating of each finding', async () => {
            const { inspection, summary } = await svc.copyReport(TENANT, SRC, { ...SAME, scope: 'rating' });
            expect((await resultsOf(inspection.id)).data).toEqual({
                [K('s1', 'i1')]: { rating: 'defect' }, [K('s1', 'i2')]: { rating: 'ok' }, [K('s2', 'i4')]: { rating: 'monitor' },
            });
            expect(summary.findings).toEqual({ copied: 3, dropped: 1 });
        });

        it('rating_notes copies rating and notes, nothing else', async () => {
            const { inspection } = await svc.copyReport(TENANT, SRC, { ...SAME, scope: 'rating_notes' });
            expect((await resultsOf(inspection.id)).data).toEqual({
                [K('s1', 'i1')]: { rating: 'defect', notes: 'Cracked shingles' }, [K('s1', 'i2')]: { rating: 'ok', notes: 'Flashing fine' }, [K('s2', 'i4')]: { rating: 'monitor', notes: 'Thin insulation' },
            });
        });

        it('all adds value, attributes, canned-comment tabs and custom comments, but never re-inspection state, repair items or unknown fields', async () => {
            const { inspection } = await svc.copyReport(TENANT, SRC, { ...SAME, scope: 'all' });
            const item = (await resultsOf(inspection.id)).data as Record<string, Record<string, unknown>>;
            expect(Object.keys(item[K('s1', 'i1')]!).sort()).toEqual(['attributes', 'customComments', 'notes', 'rating', 'tabs', 'value']);
            const tabs = item[K('s1', 'i1')]!.tabs as { defects: Array<Record<string, unknown>>; limitations: unknown[] };
            expect(tabs.defects[0]).toEqual({ cannedId: 'd1', included: true, comment: 'Lifted tabs' }); // no repair link, no photos (photos are off)
            expect(tabs.limitations).toEqual([{ cannedId: 'l1', included: true, comment: 'Not accessible' }]);
            expect(item[K('s1', 'i1')]!.customComments).toEqual({ defects: [{ id: 'cc1', title: 'Ponding', comment: 'Water at the valley', included: true }] });
            expect(item[K('s1', 'i1')]!.attributes).toEqual({ pitch: '6/12' });
        });

        it('a finding with no place in the template is dropped and counted; meta keys are neither copied nor counted', async () => {
            const { inspection, summary } = await svc.copyReport(TENANT, SRC, { ...SAME, scope: 'all' });
            const data = (await resultsOf(inspection.id)).data as Record<string, unknown>;
            expect(Object.keys(data).sort()).toEqual([K('s1', 'i1'), K('s1', 'i2'), K('s2', 'i4')]);
            expect(summary.findings).toEqual({ copied: 3, dropped: 1 });
        });

        it('tags come across with the full scope, for the findings that were copied only', async () => {
            const all = await svc.copyReport(TENANT, SRC, { ...SAME, scope: 'all' });
            const links = await testDb.select().from(schema.inspectionItemTagLinks).where(eq(schema.inspectionItemTagLinks.inspectionId, all.inspection.id)).all();
            expect(links.map((l) => [l.itemId, l.tagId])).toEqual([[K('s1', 'i1'), 'tag-1']]);
            const notes = await svc.copyReport(TENANT, SRC, { ...SAME, scope: 'rating_notes' });
            expect(count('inspection_item_tag_links', `inspection_id = '${notes.inspection.id}'`)).toBe(0);
        });

        it('the rating system the ratings were made against comes with them', async () => {
            const { inspection } = await svc.copyReport(TENANT, SRC, SAME);
            expect(await resultsOf(inspection.id)).toMatchObject({ ratingSystemId: 'rs-1', ratingSystemSnapshot: { levels: [{ id: 'defect' }] } });
        });
    });

    describe('photos', () => {
        it('are off by default: no object is read or written and no entry is carried', async () => {
            r2.log.length = 0;
            const { inspection, summary } = await svc.copyReport(TENANT, SRC, { ...SAME, scope: 'all' });
            expect(r2.log.filter((l) => /^(get|put|head):/.test(l))).toEqual([]);
            expect(r2.keys(`${TENANT}/inspections/${inspection.id}/`)).toEqual([]);
            expect(JSON.stringify((await resultsOf(inspection.id)).data)).not.toContain('photos');
            expect(summary.photos).toEqual({ requested: false, copied: 0, failed: 0, skipped: 0, unsupported: 0, droppedVariants: 0, deferred: 0, complete: null });
        });

        it('when asked for: new objects under the new prefix, sha256-equal, the entries point at them, videos are not copied, the source stays readable', async () => {
            const { inspection, summary } = await svc.copyReport(TENANT, SRC, { ...SAME, scope: 'all', photos: true });
            const newPrefix = `${TENANT}/inspections/${inspection.id}/photos/`;
            const item = (await resultsOf(inspection.id)).data as Record<string, { photos: Array<{ key: string; croppedKey?: string; mediaId?: string; annotationsJson?: string }>; tabs: { defects: Array<{ photos: Array<{ key: string }> }> }; customComments: { defects: Array<{ photos: Array<{ key: string }> }> } }>;
            const entry = item[K('s1', 'i1')]!;
            expect(entry.photos).toHaveLength(1); // the video is not a photo
            const [p] = entry.photos;
            expect(p!.key.startsWith(newPrefix)).toBe(true);
            expect(p!.croppedKey!.startsWith(newPrefix)).toBe(true);
            expect(p!.annotationsJson).toBe('[]');
            expect(p).toMatchObject({ crop: { aspect: '4:3', x: 1, y: 2, width: 3, height: 4 } });
            expect(Object.keys(p!).sort()).toEqual(['annotationsJson', 'crop', 'croppedKey', 'key', 'mediaId']);
            expect(sha(r2.store.get(p!.key)!.bytes)).toBe(sha(r2.store.get(srcPhoto('p1.jpg'))!.bytes));
            expect(sha(r2.store.get(p!.croppedKey!)!.bytes)).toBe(sha(r2.store.get(srcPhoto('p1.cropped.jpg'))!.bytes));
            expect(entry.tabs.defects[0]!.photos[0]!.key.startsWith(newPrefix)).toBe(true);
            expect(entry.customComments.defects[0]!.photos[0]!.key.startsWith(newPrefix)).toBe(true);
            // Every key the copy refers to exists and none of them is a source key.
            const referenced = JSON.stringify(item).match(/[^"]*\/photos\/[^"]+/g)!;
            for (const key of referenced) { expect(key.startsWith(newPrefix)).toBe(true); expect(r2.store.has(key)).toBe(true); }
            expect(summary.photos).toEqual({ requested: true, copied: 3, failed: 0, skipped: 1, unsupported: 0, droppedVariants: 0, deferred: 0, complete: true });
            // Deleting the source's objects leaves the copy displayable: its keys are its own.
            for (const key of r2.keys(`${TENANT}/inspections/${SRC}/`)) r2.store.delete(key);
            for (const key of referenced) expect(r2.store.has(key)).toBe(true);
        });

        it('at scope rating_notes the item photos copy and the ones nested in tabs do not exist in the copy', async () => {
            const { inspection } = await svc.copyReport(TENANT, SRC, { ...SAME, scope: 'rating_notes', photos: true });
            const entry = ((await resultsOf(inspection.id)).data as Record<string, { photos?: unknown[]; tabs?: unknown }>)[K('s1', 'i1')]!;
            expect(entry.photos).toHaveLength(1);
            expect(entry.tabs).toBeUndefined();
        });

        it('more photos than the storage budget allows: some are copied, the rest are deferred and unlinked, and the summary says the copy is not complete', async () => {
            const many = Array.from({ length: 12 }, (_, i) => { r2.seed(srcPhoto(`bulk${i}.jpg`), `bulk ${i}`); return { key: srcPhoto(`bulk${i}.jpg`) }; });
            await testDb.update(schema.inspectionResults).set({ data: { [K('s1', 'i2')]: { rating: 'ok', photos: many } } as never }).where(eq(schema.inspectionResults.id, 'src-results'));
            r2.log.length = 0;
            const { inspection, summary } = await svc.copyReport(TENANT, SRC, { ...SAME, photos: true });
            expect(summary.photos.copied).toBe(6);
            expect(summary.photos).toMatchObject({ deferred: 6, failed: 0, complete: false });
            const linked = ((await resultsOf(inspection.id)).data as Record<string, { photos: unknown[] }>)[K('s1', 'i2')]!.photos;
            expect(linked).toHaveLength(6);
            expect(r2.log.length).toBeLessThanOrEqual(30);
        });

        it('a photo that cannot be copied is not linked and leaves no object; the copy still exists and says so', async () => {
            r2.store.delete(srcPhoto('p1.jpg')); // the source file is gone
            const { inspection, summary } = await svc.copyReport(TENANT, SRC, { ...SAME, scope: 'all', photos: true });
            expect(summary.photos).toMatchObject({ copied: 2, failed: 1, complete: false });
            const referenced = JSON.stringify((await resultsOf(inspection.id)).data).match(/[^"]*\/photos\/[^"]+/g)!;
            for (const key of referenced) expect(r2.store.has(key)).toBe(true);
            expect(r2.keys(`${TENANT}/inspections/${inspection.id}/`).sort()).toEqual([...referenced].sort());
        });

        it('a baked variant that could not be copied is dropped from the entry: the copy never keeps pointing at a source file', async () => {
            r2.store.delete(srcPhoto('p1.cropped.jpg'));
            const { inspection } = await svc.copyReport(TENANT, SRC, { ...SAME, scope: 'rating_notes', photos: true });
            const text = JSON.stringify((await resultsOf(inspection.id)).data);
            expect(text).toContain('/photos/');
            expect(text).not.toContain(`/inspections/${SRC}/`);
            expect(text).not.toContain('croppedKey');
            expect(text).not.toContain('"crop"');
        });

        it('a failure after the inspection exists removes everything the attempt wrote, rows and objects', async () => {
            const inspectionsBefore = count('inspections');
            // The results write is what breaks, after the photos were already copied.
            const failing = d1For(testDb);
            const prepare = failing.prepare.bind(failing);
            failing.prepare = ((sql: string) => {
                if (/insert into "inspection_results"/i.test(sql)) throw new Error('results write failed');
                return prepare(sql);
            }) as typeof failing.prepare;
            const broken = new InspectionCopyReportService(failing, r2.bucket);
            await expect(broken.copyReport(TENANT, SRC, { ...SAME, scope: 'all', photos: true })).rejects.toThrow('results write failed');
            expect(r2.log.some((l) => l.startsWith('put:') && l.includes('/photos/'))).toBe(true); // the objects really were written first
            expect(count('inspections')).toBe(inspectionsBefore);
            expect(count('reports', `inspection_id <> '${SRC}'`)).toBe(0);
            expect(r2.keys().filter((k) => !k.includes(`/inspections/${SRC}/`))).toEqual([]);
        });
    });

    describe('property', () => {
        it('a copy at a different property starts without the old address, its facts and its people, and takes the new address', async () => {
            const people = new PeopleService({ DB: binding });
            await seedRoleProfiles(asD1Db(testDb), TENANT, new Date(1));
            await testDb.insert(schema.contacts).values({ id: 'c-1', tenantId: TENANT, type: 'client', name: 'Jane Buyer', email: 'jane@example.com', createdAt: new Date() });
            await people.addPerson(TENANT, SRC, 'c-1', `crp_${TENANT}_client`);

            await testDb.update(schema.inspections).set({ referredByContactId: 'c-1', referralSource: 'web' }).where(eq(schema.inspections.id, SRC));
            const same = await svc.copyReport(TENANT, SRC, SAME);
            expect(await people.listPeople(TENANT, same.inspection.id)).toHaveLength(1);
            expect(await inspectionOf(same.inspection.id)).toMatchObject({ referredByContactId: 'c-1', referralSource: 'web' });

            const other = await svc.copyReport(TENANT, SRC, { ...SAME, property: 'different', propertyAddress: '  9 Elm Ave  ' });
            const row = await inspectionOf(other.inspection.id);
            expect(row).toMatchObject({ propertyAddress: '9 Elm Ave', addressStreet: null, addressCity: null, addressZip: null, referredByContactId: null, referralSource: 'web', yearBuilt: null, sqft: null, referenceNumber: null, closingDate: null });
            expect(await people.listPeople(TENANT, other.inspection.id)).toHaveLength(0);
            // The findings still come across.
            expect(Object.keys((await resultsOf(other.inspection.id)).data as object)).toHaveLength(3);
        });

        it('photos are refused for a different property: 400, nothing written, no object read', async () => {
            const before = count('inspections');
            r2.log.length = 0;
            await expect(svc.copyReport(TENANT, SRC, { ...SAME, property: 'different', propertyAddress: '9 Elm Ave', photos: true })).rejects.toMatchObject({ status: 400 });
            expect(count('inspections')).toBe(before);
            expect(r2.log).toEqual([]);
        });

        it('a different property needs an address, and the refusal writes nothing', async () => {
            const before = count('inspections');
            await expect(svc.copyReport(TENANT, SRC, { ...SAME, property: 'different' })).rejects.toMatchObject({ status: 400 });
            expect(count('inspections')).toBe(before);
        });
    });

    describe('isolation', () => {
        it('another company\'s inspection answers 404 and writes nothing', async () => {
            await testDb.insert(schema.inspections).values({ id: 'foreign', tenantId: OTHER_TENANT, propertyAddress: '2 Oak', date: '2026-06-01', status: 'completed', paymentStatus: 'unpaid', price: 0, createdAt: new Date() } as never);
            const before = count('inspections');
            await expect(svc.copyReport(TENANT, 'foreign', SAME)).rejects.toMatchObject({ status: 404 });
            await expect(svc.copyReport(TENANT, 'no-such-id', SAME)).rejects.toMatchObject({ status: 404 });
            expect(count('inspections')).toBe(before);
            expect(r2.log).toEqual([]);
        });

        it('positive control: the same call with the right company succeeds', async () => {
            await expect(svc.copyReport(TENANT, SRC, SAME)).resolves.toBeDefined();
        });

        it('a photo key in the source data that points into another company is never read or copied', async () => {
            const foreign = `${OTHER_TENANT}/inspections/foreign/photos/secret.jpg`;
            r2.seed(foreign, 'CANARY-SECRET');
            const data = { ...SOURCE_DATA, [K('s1', 'i2')]: { rating: 'ok', photos: [{ key: foreign }] } };
            await testDb.update(schema.inspectionResults).set({ data: data as never }).where(eq(schema.inspectionResults.id, 'src-results'));
            r2.log.length = 0;
            const { inspection, summary } = await svc.copyReport(TENANT, SRC, { ...SAME, photos: true });
            expect(summary.photos.skipped).toBeGreaterThanOrEqual(1);
            expect(r2.log.some((l) => l.includes(foreign))).toBe(false);
            expect(JSON.stringify((await resultsOf(inspection.id)).data)).not.toContain('secret.jpg');
        });
    });

    describe('allowance', () => {
        const guardFor = () => new PlanQuotaGuard(binding, { enforced: true, billingPortalUrl: null });

        it('a free company that is enforced pays for one new inspection, and a refusal writes nothing', async () => {
            const limited = new InspectionCopyReportService(binding, r2.bucket, guardFor());
            // The cap is 5 a month and the source is an old row that does not count: each copy takes exactly one place.
            for (let i = 0; i < 5; i++) await limited.copyReport(TENANT, SRC, SAME);
            expect(count('inspections', `tenant_id = '${TENANT}'`)).toBe(6);

            const written = { inspections: count('inspections'), results: count('inspection_results'), reports: count('reports'), links: count('inspection_item_tag_links') };
            r2.log.length = 0;
            await expect(limited.copyReport(TENANT, SRC, { ...SAME, scope: 'all', photos: true })).rejects.toMatchObject({ status: 402, code: 'QUOTA_EXHAUSTED' });
            expect({ inspections: count('inspections'), results: count('inspection_results'), reports: count('reports'), links: count('inspection_item_tag_links') }).toEqual(written);
            expect(r2.log).toEqual([]);
        });

        it('positive control: with no guard (a standalone deployment) the same number of copies all go through', async () => {
            for (let i = 0; i < 8; i++) await svc.copyReport(TENANT, SRC, SAME);
            expect(count('inspections', `tenant_id = '${TENANT}'`)).toBe(9);
        });

        it('a copy of a source that does not exist consumes nothing', async () => {
            const spy = vi.spyOn(PlanQuotaGuard.prototype, 'consumeInspection');
            const limited = new InspectionCopyReportService(binding, r2.bucket, guardFor());
            await expect(limited.copyReport(TENANT, 'no-such-id', SAME)).rejects.toMatchObject({ status: 404 });
            expect(spy).not.toHaveBeenCalled();
            await limited.copyReport(TENANT, SRC, SAME);
            expect(spy).toHaveBeenCalledTimes(1);
            spy.mockRestore();
        });
    });

    describe('a failure gives the place back and leaves nothing', () => {
        it.each([
            ['the inspection insert', /insert into "inspections"/i],
            ['the report insert (the copy could not be opened without it)', /insert into "reports"/i],
            ['the results insert', /insert into "inspection_results"/i],
        ])('%s fails: error surfaced, the allowance released once, no row and no object left', async (_name, pattern) => {
            const consume = vi.spyOn(PlanQuotaGuard.prototype, 'consumeInspection');
            const release = vi.spyOn(PlanQuotaGuard.prototype, 'releaseInspection');
            const failing = d1For(testDb);
            const prepare = failing.prepare.bind(failing);
            failing.prepare = ((sql: string) => {
                if (pattern.test(sql)) throw new Error('write failed');
                return prepare(sql);
            }) as typeof failing.prepare;
            const broken = new InspectionCopyReportService(failing, r2.bucket, new PlanQuotaGuard(binding, { enforced: true, billingPortalUrl: null }));
            const before = { inspections: count('inspections'), reports: count('reports'), results: count('inspection_results') };

            await expect(broken.copyReport(TENANT, SRC, { ...SAME, scope: 'all', photos: true })).rejects.toThrow();

            expect(consume).toHaveBeenCalledTimes(1);
            expect(release).toHaveBeenCalledTimes(1);
            expect({ inspections: count('inspections'), reports: count('reports'), results: count('inspection_results') }).toEqual(before);
            expect(r2.keys().filter((k) => !k.includes(`/inspections/${SRC}/`))).toEqual([]);
            consume.mockRestore();
            release.mockRestore();
        });

        it('positive control: a copy that succeeds does not release anything', async () => {
            const release = vi.spyOn(PlanQuotaGuard.prototype, 'releaseInspection');
            await new InspectionCopyReportService(binding, r2.bucket, new PlanQuotaGuard(binding, { enforced: true, billingPortalUrl: null })).copyReport(TENANT, SRC, SAME);
            expect(release).not.toHaveBeenCalled();
            release.mockRestore();
        });
    });

    describe('nothing the source holds in any inspection-keyed table reaches the copy', () => {
        /** Tables the copy writes to on purpose; each has its own tests above. */
        const CARRIED = new Set(['inspection_results', 'reports', 'inspection_inspectors', 'inspection_people', 'inspection_item_tag_links']);

        function inspectionKeyedTables(): string[] {
            const all = sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%'`).all() as Array<{ name: string }>;
            return all.map((t) => t.name).filter((name) => (sqlite.prepare(`PRAGMA table_info("${name}")`).all() as Array<{ name: string }>).some((c) => c.name === 'inspection_id'));
        }

        /** One row per table, every text column (JSON columns included) carrying a canary, keyed to the SOURCE inspection. */
        function seedCanaryRow(table: string): void {
            const cols = sqlite.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string; type: string }>;
            const values: Record<string, string | number | Buffer> = {};
            for (const c of cols) {
                const type = c.type.toUpperCase();
                if (c.name === 'inspection_id') values[c.name] = SRC;
                else if (c.name === 'tenant_id') values[c.name] = TENANT;
                else if (type.includes('INT')) values[c.name] = 1;
                else if (type.includes('REAL')) values[c.name] = 1.5;
                else if (type.includes('BLOB')) values[c.name] = Buffer.from('CANARY-BLOB');
                else values[c.name] = `CANARY-${table}-${c.name}`;
            }
            sqlite.prepare(`INSERT INTO "${table}" (${cols.map((c) => `"${c.name}"`).join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => values[c.name]));
        }

        it('every inspection-keyed table holds a canary row for the source, and after a copy of everything none of it is in anything the copy owns', async () => {
            const tables = inspectionKeyedTables();
            expect(tables.length).toBeGreaterThan(20); // generated from the schema, never listed by hand
            for (const carried of CARRIED) expect(tables, carried).toContain(carried);

            const notSeeded: string[] = [];
            // The canary rows stand alone: their other keys point at nothing, which only the copy's own queries could follow.
            sqlite.pragma('foreign_keys = OFF');
            for (const table of tables.filter((t) => !CARRIED.has(t))) {
                try { seedCanaryRow(table); } catch (err) { notSeeded.push(`${table}: ${(err as Error).message}`); }
            }
            sqlite.pragma('foreign_keys = ON');
            expect(notSeeded).toEqual([]);

            const { inspection } = await svc.copyReport(TENANT, SRC, { ...SAME, scope: 'all', photos: true });

            // Rows keyed to the copy exist only in the tables the copy writes on purpose.
            const withRows = tables.filter((t) => count(t, `inspection_id = '${inspection.id}'`) > 0);
            expect(withRows.filter((t) => !CARRIED.has(t))).toEqual([]);
            const owned = everythingMentioning(inspection.id);
            expect(owned).not.toContain('CANARY-' + 'inspection_');
            for (const canary of CANARIES) expect(owned, canary).not.toContain(canary);
            expect(owned).not.toMatch(/CANARY-[a-z_]+-/);
        });

        it('the lead and helpers of the source are on the copy', async () => {
            await testDb.insert(schema.users).values([
                { id: 'u-lead', tenantId: TENANT, email: 'lead@acme.com', passwordHash: 'h', role: 'inspector', createdAt: new Date() },
                { id: 'u-help', tenantId: TENANT, email: 'help@acme.com', passwordHash: 'h', role: 'inspector', createdAt: new Date() },
            ] as never);
            await testDb.insert(schema.inspectionInspectors).values([
                { inspectionId: SRC, userId: 'u-lead', tenantId: TENANT, role: 'lead', createdAt: new Date(1) },
                { inspectionId: SRC, userId: 'u-help', tenantId: TENANT, role: 'helper', createdAt: new Date(1) },
            ]);
            const { inspection } = await svc.copyReport(TENANT, SRC, { ...SAME, property: 'different', propertyAddress: '9 Elm Ave' });
            const rows = await testDb.select().from(schema.inspectionInspectors).where(eq(schema.inspectionInspectors.inspectionId, inspection.id)).all();
            expect(rows.map((r) => [r.userId, r.role]).sort()).toEqual([['u-help', 'helper'], ['u-lead', 'lead']]);
        });
    });

    describe('what the summary says about photos', () => {
        const setPhotos = (photos: unknown[]) => testDb.update(schema.inspectionResults).set({ data: { [K('s1', 'i2')]: { rating: 'ok', photos } } as never }).where(eq(schema.inspectionResults.id, 'src-results'));

        it('photos not asked for: complete is null, never "complete"', async () => {
            const { summary } = await svc.copyReport(TENANT, SRC, SAME);
            expect(summary.photos).toMatchObject({ requested: false, complete: null });
        });

        it('photos stored under an older key layout are skipped and the copy is NOT complete', async () => {
            const legacy = Array.from({ length: 3 }, (_, i) => { const k = `${TENANT}/${SRC}/photos/old${i}.jpg`; r2.seed(k, 'x'); return { key: k }; });
            await setPhotos(legacy);
            const { summary } = await svc.copyReport(TENANT, SRC, { ...SAME, photos: true });
            expect(summary.photos).toMatchObject({ copied: 0, skipped: 3, unsupported: 3, complete: false });
        });

        it('a baked variant that was dropped makes the copy incomplete, although the photo itself copied', async () => {
            r2.store.delete(srcPhoto('p1.cropped.jpg'));
            const { summary } = await svc.copyReport(TENANT, SRC, { ...SAME, photos: true });
            expect(summary.photos).toMatchObject({ failed: 0, deferred: 0, droppedVariants: 1, complete: false });
        });

        it('positive control: every photo and variant copied, a video skipped: complete is true', async () => {
            const { summary } = await svc.copyReport(TENANT, SRC, { ...SAME, photos: true });
            expect(summary.photos).toMatchObject({ skipped: 1, unsupported: 0, droppedVariants: 0, complete: true });
        });
    });

    describe('a different property, column by column', () => {
        /** The columns that describe the other property or job; the privacy decision, written out rather than read back from the code. */
        const CLEARED = ['address_place_id', 'address_street', 'address_city', 'address_state', 'address_zip', 'address_county', 'address_lat', 'address_lng', 'address_geocoded_at',
            'year_built', 'sqft', 'foundation_type', 'bedrooms', 'bathrooms', 'lot_size', 'unit', 'county', 'property_type', 'commercial_subtype', 'reference_number', 'closing_date', 'referred_by_contact_id'];
        const SET_BY_COPY = ['id', 'tenant_id', 'date', 'created_at', 'status', 'payment_status', 'property_address'];

        type Info = { name: string; type: string };
        const columns = (): Info[] => sqlite.prepare(`PRAGMA table_info("inspections")`).all() as Info[];
        // Boolean columns (`is_*`) read back as true only for 1; every other integer column gets 7.
        const wide = (c: Info): string | number => (c.type.toUpperCase().includes('INT') ? (c.name.startsWith('is_') ? 1 : 7) : c.type.toUpperCase().includes('REAL') ? 7.5 : `"WIDE-${c.name}"`);

        it('every column the table has is either cleared, carried as the clone allow-list says, or back at its default, with the source set to non-default values throughout', async () => {
            const cols = columns();
            for (const name of CLEARED) expect(cols.map((c) => c.name), name).toContain(name);

            // A source with EVERY column set to a distinct non-default value (JSON-safe text, so it reads back through the ORM).
            sqlite.pragma('foreign_keys = OFF');
            const values: Record<string, string | number> = {};
            for (const c of cols) values[c.name] = wide(c);
            Object.assign(values, { id: 'wide-src', tenant_id: TENANT, template_snapshot: JSON.stringify(TEMPLATE), property_address: '1 Wide St', date: '2026-06-01', status: 'completed', payment_status: 'paid' });
            sqlite.prepare(`INSERT INTO inspections (${cols.map((c) => `"${c.name}"`).join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => values[c.name] as string | number));
            // The wide row points at no inspector, template or contact that exists; keys stay unenforced for this test.

            // What a fresh row holds by default, for every column the copy does not carry.
            sqlite.prepare(`INSERT INTO inspections (id, tenant_id, property_address, date, created_at) VALUES ('pristine', ?, 'x', 'x', 1)`).run(TENANT);
            const pristine = sqlite.prepare(`SELECT * FROM inspections WHERE id = 'pristine'`).get() as Record<string, unknown>;
            const wideRow = sqlite.prepare(`SELECT * FROM inspections WHERE id = 'wide-src'`).get() as Record<string, unknown>;

            const carried = new Set(Object.keys(cloneInsertValues(await inspectionOf('wide-src'), { id: 'x', tenantId: TENANT, date: 'x', createdAt: new Date(0) })).map((p) => columnNameOf(p)));
            for (const mode of ['same', 'different'] as const) {
                const { inspection } = await svc.copyReport(TENANT, 'wide-src', mode === 'same' ? SAME : { ...SAME, property: 'different', propertyAddress: '9 Elm Ave' });
                const row = sqlite.prepare(`SELECT * FROM inspections WHERE id = ?`).get(inspection.id) as Record<string, unknown>;
                for (const c of cols) {
                    if (SET_BY_COPY.includes(c.name)) continue;
                    const expected = mode === 'different' && CLEARED.includes(c.name) ? null : carried.has(c.name) ? wideRow[c.name] : pristine[c.name];
                    expect(row[c.name], `${mode}: ${c.name}`).toEqual(expected);
                }
            }
            // The set really exercised the table: a few dozen columns, most of them not carried.
            expect(cols.length).toBeGreaterThan(60);
            expect(cols.filter((c) => !carried.has(c.name)).length).toBeGreaterThan(20);
        });
    });

    describe('the allowance is only given back when nothing is left to count', () => {
        it('a rollback that could not finish does not release, and the original error is what surfaces', async () => {
            const release = vi.spyOn(PlanQuotaGuard.prototype, 'releaseInspection');
            const failing = d1For(testDb);
            const prepare = failing.prepare.bind(failing);
            failing.prepare = ((sql: string) => {
                if (/insert into "reports"/i.test(sql)) throw new Error('write failed');
                if (/^delete from/i.test(sql)) throw new Error('cleanup failed');
                return prepare(sql);
            }) as typeof failing.prepare;
            const broken = new InspectionCopyReportService(failing, r2.bucket, new PlanQuotaGuard(binding, { enforced: true, billingPortalUrl: null }));
            await expect(broken.copyReport(TENANT, SRC, SAME)).rejects.toThrow('the primary report of the copy could not be created');
            expect(release).not.toHaveBeenCalled();
            release.mockRestore();
        });

        it('an id that cannot be made fails before the allowance is taken', async () => {
            const consume = vi.spyOn(PlanQuotaGuard.prototype, 'consumeInspection');
            const uuid = vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementationOnce(() => { throw new Error('no entropy'); });
            const limited = new InspectionCopyReportService(binding, r2.bucket, new PlanQuotaGuard(binding, { enforced: true, billingPortalUrl: null }));
            await expect(limited.copyReport(TENANT, SRC, SAME)).rejects.toThrow('no entropy');
            expect(consume).not.toHaveBeenCalled();
            uuid.mockRestore();
            consume.mockRestore();
        });
    });

    describe('people and roster say whether they came across', () => {
        it('both true on success (same property), people not requested for a different one', async () => {
            const same = await svc.copyReport(TENANT, SRC, SAME);
            expect(same.summary).toMatchObject({ people: { requested: true, copied: true }, roster: { copied: true } });
            const other = await svc.copyReport(TENANT, SRC, { ...SAME, property: 'different', propertyAddress: '9 Elm Ave' });
            expect(other.summary.people).toEqual({ requested: false, copied: true });
        });

        it('a failing people copy is reported in the summary instead of passing silently', async () => {
            const spy = vi.spyOn(PeopleService.prototype, 'listPeople').mockRejectedValue(new Error('boom'));
            const { summary } = await svc.copyReport(TENANT, SRC, SAME);
            expect(summary.people).toEqual({ requested: true, copied: false });
            spy.mockRestore();
        });
    });

    describe('the scanner that backs the canary tests', () => {
        it('finds a canary stored in a blob column (positive control)', () => {
            sqlite.exec(`CREATE TABLE canary_probe (inspection_id TEXT, b BLOB)`);
            sqlite.prepare(`INSERT INTO canary_probe VALUES ('probe-id', ?)`).run(Buffer.from('CANARY-BLOB-probe'));
            expect(everythingMentioning('probe-id')).toContain('CANARY-BLOB-probe');
        });
    });

    it('sends nothing to anyone: no network call is made while copying everything with photos', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        await svc.copyReport(TENANT, SRC, { ...SAME, scope: 'all', photos: true });
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(count('inspection_messages', `tenant_id = '${TENANT}'`)).toBe(0);
        fetchSpy.mockRestore();
    });

    it('the copy is an ordinary editable inspection: it can itself be copied', async () => {
        const first = await svc.copyReport(TENANT, SRC, { ...SAME, scope: 'all' });
        const second = await svc.copyReport(TENANT, first.inspection.id, { ...SAME, scope: 'all' });
        expect(Object.keys((await resultsOf(second.inspection.id)).data as object)).toHaveLength(3);
        // `and` keeps the lookup tenant-scoped, as every read of this table is.
        expect(await testDb.select().from(schema.inspections).where(and(eq(schema.inspections.id, second.inspection.id), eq(schema.inspections.tenantId, TENANT))).get()).toBeTruthy();
    });
});
