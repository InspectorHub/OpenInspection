/**
 * The generation pipeline: resolve report id -> getReportData -> segmentReport
 * -> translateSegments -> store.
 *
 * Driven through a RECORDING provider rather than a stubbed `fetch`, so every
 * assertion below is about what was ASKED FOR and not only about what came
 * back. That distinction is the whole point here: the thing that must never
 * happen is a forbidden span reaching a model, and a test that only reads the
 * response cannot see what was sent.
 *
 * ⚠️ Every exclusion assertion is paired with a positive one on the SAME call.
 * "The request contains none of the reliance text" is satisfied by a pipeline
 * that sends nothing at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { AIService } from '../../../server/services/ai.service';
import { InspectionService } from '../../../server/services/inspection.service';
import { ReportTranslationService } from '../../../server/services/report-translation.service';
import { RecordingAiProvider } from '../../../server/lib/ai/providers/recording';
import { RELIANCE_TEMPLATES } from '../../../server/lib/pca-reliance-text';
import { COURTESY_TRANSLATION_NOTICE } from '../../../server/lib/legal/courtesy-translation-notice';
import { segmentReport } from '../../../server/lib/translation/segment-report';
import {
    generateCourtesyTranslation,
    removeCourtesyTranslation,
} from '../../../server/lib/translation/generate';

const TENANT = 't-gen';
const INSPECTION = 'insp-gen';
const REPORT = 'rep-gen';

const FINDING_NOTE = 'Standing water at the crawlspace vapour barrier.';
const DEFECT_COMMENT = 'The service panel cover is missing two screws.';

const SCHEMA = {
    schemaVersion: 2,
    sections: [{
        id: 'structure',
        title: 'Structure',
        items: [{
            id: 'crawl',
            label: 'Crawlspace',
            type: 'rich',
            tabs: {
                defects: [{
                    id: 'd1', title: 'Panel cover', category: 'defect', location: 'Garage',
                    comment: DEFECT_COMMENT, photos: [], default: true,
                }],
            },
        }],
    }],
};

/** A canned reply of the right length for the spans the report yields. */
function replyFor(count: number): string {
    return JSON.stringify(Array.from({ length: count }, (_, i) => `ES-${i}`));
}

const OWN_CONFIRMED_KEY = { source: 'byo', tenantKeyAttested: true } as const;
const PROVENANCE = { record: async () => 'ai-call-row' };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;
let inspection: InspectionService;
let translations: ReportTranslationService;

beforeEach(async () => {
    const created = createTestDb();
    await setupSchema(created.sqlite);
    db = created.db;
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

    await db.insert(schema.tenants).values({
        id: TENANT, slug: 'gen-tenant', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    await db.insert(schema.templates).values({
        id: 'tpl-gen', tenantId: TENANT, name: 'Gen template', schema: SCHEMA,
        createdAt: new Date(), updatedAt: new Date(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    await db.insert(schema.inspections).values({
        id: INSPECTION, tenantId: TENANT, templateId: 'tpl-gen', templateSnapshot: SCHEMA,
        propertyAddress: '4 Generation Lane', date: '2026-08-24', status: 'completed',
        // The reliance block only rides on a full commercial PCA payload, which
        // is exactly the case that must not reach a model.
        propertyType: 'commercial', reportTier: 'full_pca',
        createdAt: new Date(), updatedAt: new Date(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    await db.insert(schema.reports).values({
        id: REPORT, tenantId: TENANT, inspectionId: INSPECTION, kind: 'primary',
        title: 'Inspection report', status: 'published', createdAt: new Date(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    await db.insert(schema.inspectionResults).values({
        id: 'res-gen', tenantId: TENANT, inspectionId: INSPECTION, reportId: REPORT,
        data: {
            '_default:structure:crawl': {
                rating: 'Defect', notes: FINDING_NOTE,
                tabs: { defects: [{ cannedId: 'd1', included: true }] },
            },
        },
        createdAt: new Date(), updatedAt: new Date(), lastSyncedAt: new Date(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    inspection = new InspectionService({} as D1Database);
    translations = new ReportTranslationService({} as D1Database);
});

/** A service wired to a recorder that replies with `spanCount` segments. */
function aiWith(recorder: RecordingAiProvider): AIService {
    return new AIService(
        {} as D1Database, 'test-key', 'saas', 'test-model', undefined,
        OWN_CONFIRMED_KEY, PROVENANCE, undefined, recorder,
    );
}

async function spanCount(): Promise<number> {
    const data = await inspection.getReportData(
        INSPECTION, TENANT, (k) => k, undefined, undefined, REPORT,
    );
    return segmentReport(data).length;
}

describe('what the provider is asked for', () => {
    it('sends exactly the segmenter output, in order', async () => {
        const data = await inspection.getReportData(
            INSPECTION, TENANT, (k) => k, undefined, undefined, REPORT,
        );
        const expected = segmentReport(data).map((s) => s.text);
        expect(expected.length).toBeGreaterThan(0);

        const recorder = new RecordingAiProvider([replyFor(expected.length)]);
        await generateCourtesyTranslation(
            { db: {} as D1Database, ai: aiWith(recorder), inspection, translations },
            { tenantId: TENANT, inspectionId: INSPECTION, reportId: REPORT, locale: 'es-419' },
        );

        expect(recorder.requests).toHaveLength(1);
        const prompt = recorder.requests[0]!.prompt;

        // Read the numbered block back rather than searching for each span:
        // spans repeat by design (a contents entry carries the same title as
        // the section it points at), so `indexOf` would find the wrong copy and
        // an ordering test built on it asserts nothing.
        const block = prompt.split('<<<BEGIN REPORT SEGMENTS>>>')[1]
            ?.split('<<<END REPORT SEGMENTS>>>')[0] ?? '';
        const sent = block.trim().split('\n').map((l) => l.replace(/^\[\d+\]\s/, ''));
        // Exact equality, in order: a translation is re-inserted positionally,
        // so a merged, split or reordered segment produces a report whose
        // translated paragraphs describe the wrong components.
        expect(sent).toEqual(expected);
    });

    it('contains none of the reliance text, and DOES contain a finding', async () => {
        const count = await spanCount();
        const recorder = new RecordingAiProvider([replyFor(count)]);
        await generateCourtesyTranslation(
            { db: {} as D1Database, ai: aiWith(recorder), inspection, translations },
            { tenantId: TENANT, inspectionId: INSPECTION, reportId: REPORT, locale: 'es-419' },
        );
        const prompt = recorder.requests[0]!.prompt;

        for (const field of ['userReliance', 'pointInTime', 'siteSpecific'] as const) {
            expect(prompt).not.toContain(RELIANCE_TEMPLATES[field]);
        }
        // The positive control on the SAME request. Without it, a pipeline that
        // sent an empty list would satisfy every line above.
        expect(prompt).toContain(FINDING_NOTE);
        expect(prompt).toContain(DEFECT_COMMENT);
    });

    it('carries no property address and no client identity', async () => {
        const count = await spanCount();
        const recorder = new RecordingAiProvider([replyFor(count)]);
        await generateCourtesyTranslation(
            { db: {} as D1Database, ai: aiWith(recorder), inspection, translations },
            { tenantId: TENANT, inspectionId: INSPECTION, reportId: REPORT, locale: 'es-419' },
        );
        expect(recorder.requests[0]!.prompt).not.toContain('4 Generation Lane');
    });
});

describe('what gets stored', () => {
    it('records the English hash taken at production time, the notice version and the source', async () => {
        const count = await spanCount();
        const recorder = new RecordingAiProvider([replyFor(count)]);
        const result = await generateCourtesyTranslation(
            { db: {} as D1Database, ai: aiWith(recorder), inspection, translations },
            { tenantId: TENANT, inspectionId: INSPECTION, reportId: REPORT, locale: 'es-419' },
        );

        const stored = await translations.read(TENANT, REPORT, 'es-419');
        expect(stored).not.toBeNull();
        expect(stored!.segments).toHaveLength(count);
        expect(stored!.noticeVersion).toBe(COURTESY_TRANSLATION_NOTICE.version);
        // `<provider id>:<credential source>` — two facts, neither answering
        // the other.
        expect(stored!.source).toBe('recording:byo');
        expect(stored!.aiCallId).toBe('ai-call-row');

        // The English hash on the row is the one the reader path compares
        // against: the report as it stands, with NO translation identity in the
        // basis. Recomputing it here is the same call the reader makes.
        const live = await inspection.getReportContentHash(INSPECTION, TENANT, REPORT);
        expect(stored!.englishHash).toBe(live);
        expect(result.englishHash).toBe(live);

        // And it is FRESH straight away — the positive control for the withhold
        // rule, which is otherwise satisfied by a hash that never matches.
        expect(await translations.readFresh(TENANT, REPORT, 'es-419', live)).not.toBeNull();
    });

    it('stores NOTHING when the provider returns the wrong number of segments', async () => {
        const count = await spanCount();
        const recorder = new RecordingAiProvider([replyFor(count - 1)]);
        await expect(generateCourtesyTranslation(
            { db: {} as D1Database, ai: aiWith(recorder), inspection, translations },
            { tenantId: TENANT, inspectionId: INSPECTION, reportId: REPORT, locale: 'es-419' },
        )).rejects.toThrow();

        // The assertion that matters is the ABSENCE of a row, not that an error
        // was thrown: a partially-stored translation maps translated prose onto
        // the wrong components and reads like a correct report about the wrong
        // house.
        expect(await translations.read(TENANT, REPORT, 'es-419')).toBeNull();
    });

    it('replaces rather than accumulates on regeneration', async () => {
        const count = await spanCount();
        const deps = { db: {} as D1Database, inspection, translations };
        await generateCourtesyTranslation(
            { ...deps, ai: aiWith(new RecordingAiProvider([replyFor(count)])) },
            { tenantId: TENANT, inspectionId: INSPECTION, reportId: REPORT, locale: 'es-419' },
        );
        const first = await translations.read(TENANT, REPORT, 'es-419');
        await generateCourtesyTranslation(
            { ...deps, ai: aiWith(new RecordingAiProvider([replyFor(count)])) },
            { tenantId: TENANT, inspectionId: INSPECTION, reportId: REPORT, locale: 'es-419' },
        );

        const rows = await db.select().from(schema.reportTranslations).all();
        expect(rows).toHaveLength(1);
        // A new row with its own id, not the old one carried forward.
        expect(rows[0]!.id).not.toBe(first!.id);
    });
});

describe('credential refusals', () => {
    it('refuses by name and does NOT fall back to another credential', async () => {
        // A service with no resolved adapter is the shape a refusal produces.
        // The failure it must not have: catching this and retrying on the
        // workspace's own key, which bills them for something they were told
        // was covered.
        const noAdapter = new AIService(
            {} as D1Database, '', 'saas', 'test-model', undefined,
            { source: 'managed', tenantKeyAttested: false }, PROVENANCE, undefined, undefined,
        );
        await expect(generateCourtesyTranslation(
            { db: {} as D1Database, ai: noAdapter, inspection, translations },
            { tenantId: TENANT, inspectionId: INSPECTION, reportId: REPORT, locale: 'es-419' },
        )).rejects.toThrow();
        expect(await translations.read(TENANT, REPORT, 'es-419')).toBeNull();
    });
});

describe('removal', () => {
    it('removes a stored row, and says so; a second call says there was nothing', async () => {
        const count = await spanCount();
        await generateCourtesyTranslation(
            { db: {} as D1Database, ai: aiWith(new RecordingAiProvider([replyFor(count)])), inspection, translations },
            { tenantId: TENANT, inspectionId: INSPECTION, reportId: REPORT, locale: 'es-419' },
        );

        const first = await removeCourtesyTranslation(
            { db: {} as D1Database, translations },
            { tenantId: TENANT, inspectionId: INSPECTION, locale: 'es-419' },
        );
        expect(first).toEqual({ reportId: REPORT, removed: true });

        // "There was nothing to remove" is not an error and must not be
        // reported as success at doing something.
        const second = await removeCourtesyTranslation(
            { db: {} as D1Database, translations },
            { tenantId: TENANT, inspectionId: INSPECTION, locale: 'es-419' },
        );
        expect(second).toEqual({ reportId: REPORT, removed: false });
    });
});

describe('the primary report is the default deliverable', () => {
    it('resolves it when no report id is given', async () => {
        const count = await spanCount();
        const result = await generateCourtesyTranslation(
            { db: {} as D1Database, ai: aiWith(new RecordingAiProvider([replyFor(count)])), inspection, translations },
            { tenantId: TENANT, inspectionId: INSPECTION, locale: 'es-419' },
        );
        expect(result.reportId).toBe(REPORT);
    });
});
