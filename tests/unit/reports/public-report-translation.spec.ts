/**
 * The reader side of the courtesy translation, and the three things it must
 * never do — one per invariant in `server/lib/translation/read-for-report.ts`.
 *
 * 1. **Serve a stale one.** The withhold rule is asserted explicitly, paired
 *    with a matching-hash control on the same fixture — a read that always
 *    returned null would satisfy "withheld" on its own, and that is the failure
 *    that looks exactly like the feature working.
 * 2. **Consult the tenant setting.** Switching production off must leave every
 *    already-published report untouched. Asserted by switching it off and
 *    re-reading, because the invariant lives in prose everywhere else and prose
 *    is not a test.
 * 3. **Map a mismatched segment list positionally.** The third invariant was
 *    described in that header as tested and was not. Its own branch comment
 *    calls it unreachable, which is the argument FOR asserting it: an
 *    unreachable branch nobody exercises is a branch nobody notices becoming
 *    reachable.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { InspectionService } from '../../../server/services/inspection.service';
import { ReportTranslationService } from '../../../server/services/report-translation.service';
import { readCourtesyTranslationForReport } from '../../../server/lib/translation/read-for-report';
import { segmentReport } from '../../../server/lib/translation/segment-report';
import { COURTESY_TRANSLATION_NOTICE } from '../../../server/lib/legal/courtesy-translation-notice';

const TENANT = 't-read';
const INSPECTION = 'insp-read';
const REPORT = 'rep-read';
const LOCALE = 'es-419';

const SCHEMA = {
    schemaVersion: 2,
    sections: [{
        id: 'roof',
        title: 'Roof',
        items: [{ id: 'covering', label: 'Roof covering', type: 'rich' }],
    }],
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;
let inspection: InspectionService;
let translations: ReportTranslationService;

/** Store a translation whose english_hash is the report's CURRENT hash. */
async function storeFresh(): Promise<string[]> {
    const data = await inspection.getReportData(
        INSPECTION, TENANT, (k) => k, undefined, undefined, REPORT,
    );
    const segments = segmentReport(data).map((_, i) => `ES-${i}`);
    const englishHash = await inspection.getReportContentHash(INSPECTION, TENANT, REPORT);
    await translations.store(TENANT, REPORT, LOCALE, {
        segments, source: 'recording:byo', englishHash, aiCallId: 'call-1',
    });
    return segments;
}

async function read() {
    const data = await inspection.getReportData(
        INSPECTION, TENANT, (k) => k, undefined, undefined, REPORT,
    );
    return readCourtesyTranslationForReport(
        { db: {} as D1Database, inspection, translations },
        { tenantId: TENANT, inspectionId: INSPECTION, locale: LOCALE, data },
    );
}

beforeEach(async () => {
    const created = createTestDb();
    await setupSchema(created.sqlite);
    db = created.db;
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

    await db.insert(schema.tenants).values({
        id: TENANT, slug: 'read-tenant', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    await db.insert(schema.tenantConfigs).values({
        tenantId: TENANT,
        createdAt: new Date(), updatedAt: new Date(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    // The production switch reads `tenant_ai_configs` — a separate table since
    // the AI fields moved off `tenant_configs`, which had hit D1's 100-column
    // ceiling. Seeding the old row alone leaves the switch OFF, which is the
    // fail-closed default and would make every assertion below measure a
    // refusal instead of the behaviour it names.
    await db.insert(schema.tenantAiConfigs).values({
        tenantId: TENANT, isCourtesyTranslationEnabled: true, updatedAt: new Date(),
    });
    await db.insert(schema.templates).values({
        id: 'tpl-read', tenantId: TENANT, name: 'T', schema: SCHEMA,
        createdAt: new Date(), updatedAt: new Date(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    await db.insert(schema.inspections).values({
        id: INSPECTION, tenantId: TENANT, templateId: 'tpl-read', templateSnapshot: SCHEMA,
        propertyAddress: '7 Reader Road', date: '2026-08-24', status: 'completed',
        createdAt: new Date(), updatedAt: new Date(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    await db.insert(schema.reports).values({
        id: REPORT, tenantId: TENANT, inspectionId: INSPECTION, kind: 'primary',
        title: 'Inspection report', status: 'published', createdAt: new Date(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    await db.insert(schema.inspectionResults).values({
        id: 'res-read', tenantId: TENANT, inspectionId: INSPECTION, reportId: REPORT,
        data: { '_default:roof:covering': { rating: 'Defect', notes: 'Original finding.' } },
        createdAt: new Date(), updatedAt: new Date(), lastSyncedAt: new Date(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    inspection = new InspectionService({} as D1Database);
    translations = new ReportTranslationService({} as D1Database);
});

describe('the hash decides whether a reader sees it', () => {
    it('returns the translation when the hash matches — the control', () => {
        return (async () => {
            const segments = await storeFresh();
            const payload = await read();
            expect(payload).not.toBeNull();
            expect(payload!.locale).toBe(LOCALE);
            expect(payload!.segments).toEqual(segments);
            // Paths travel with the segments so a renderer never re-derives
            // them — a second implementation of the segmenter would drift.
            expect(payload!.paths).toHaveLength(segments.length);
            expect(payload!.paths[0]).toMatch(/^sections\./);
        })();
    });

    it('WITHHOLDS it once the English moves', async () => {
        await storeFresh();
        expect(await read()).not.toBeNull();

        // One edit to the report the translation was made from.
        await db.update(schema.inspectionResults)
            .set({ data: { '_default:roof:covering': { rating: 'Defect', notes: 'Corrected finding.' } } })
            .where(eq(schema.inspectionResults.id, 'res-read'))
            .run();

        expect(await read()).toBeNull();
    });

    it('returns null when nothing was ever stored', async () => {
        expect(await read()).toBeNull();
    });
});

describe('the segment count must still line up', () => {
    it('REFUSES a stored list whose length no longer matches the segmenter', async () => {
        // The third invariant in read-for-report.ts's header. Its own comment
        // calls this branch "should be unreachable" — a matching hash means the
        // render inputs are byte-identical, so the segmenter's output is too —
        // and that is exactly why it needs an assertion rather than a reader.
        // Segments are re-inserted POSITIONALLY, so a list one longer than the
        // spans maps translated prose onto the wrong components and produces a
        // document that reads correctly and describes the wrong house. Nothing
        // downstream detects that: no gate, no test of the rendered document,
        // and no reader who does not speak both languages.
        const segments = await storeFresh();
        // The control, on the same fixture and in the same test: a read that
        // always returned null would satisfy the refusal below on its own.
        expect(await read(), 'the fixture must be readable before it is broken').not.toBeNull();

        const englishHash = await inspection.getReportContentHash(INSPECTION, TENANT, REPORT);
        await translations.store(TENANT, REPORT, LOCALE, {
            // One extra segment, and the SAME English hash — so the check above
            // this one in read-for-report.ts passes and this is the only thing
            // standing between the reader and a misaligned document.
            segments: [...segments, 'ES-extra'],
            source: 'recording:byo',
            englishHash,
            aiCallId: 'call-2',
        });

        expect(await read()).toBeNull();
    });
});

describe('the reader path never consults the tenant setting', () => {
    it('still serves a delivered translation after production is switched OFF', async () => {
        await storeFresh();
        expect(await read()).not.toBeNull();

        await db.update(schema.tenantAiConfigs)
            .set({ isCourtesyTranslationEnabled: false })
            .where(eq(schema.tenantAiConfigs.tenantId, TENANT))
            .run();

        // The invariant. A loader that asked "is this enabled?" before showing
        // the toggle would silently strip the translation from every report
        // already delivered, the moment somebody changed a setting.
        const after = await read();
        expect(after).not.toBeNull();
        expect(after!.segments.length).toBeGreaterThan(0);
    });
});

describe('the notice travels with the payload', () => {
    it('carries the notice, its version, and whether it is authoritative', async () => {
        await storeFresh();
        const payload = await read();
        expect(payload!.notice.version).toBe(COURTESY_TRANSLATION_NOTICE.version);
        expect(payload!.notice.text).toBe(COURTESY_TRANSLATION_NOTICE.text);
        // No language is reviewed yet, so a Spanish reader is shown the English
        // notice — which IS the record, hence authoritative.
        expect(payload!.notice.locale).toBe('en');
        expect(payload!.notice.authoritative).toBe(true);
    });
});
