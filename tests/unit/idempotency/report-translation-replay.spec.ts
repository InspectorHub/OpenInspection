/**
 * Tier 1: regenerating a courtesy translation. It SPENDS MONEY — one provider
 * call per press — and the cost lands on whichever key the workspace configured.
 * A retried request that reaches the handler twice bills twice and writes a
 * second `ai_call_provenance` row, and neither the workspace nor the client can
 * see that it happened: the second translation replaces the first, so the
 * visible end state of one call and two calls is identical.
 *
 * That is the shape this class of guard exists for. A duplicate whose damage is
 * invisible in the result is the one nobody reports.
 *
 * The route is tenant-authenticated, so the global mount in `server/index.ts`
 * already spans it. This spec proves the whole tail — the provider call — sits
 * inside that span.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { OpenAPIHono } from '@hono/zod-openapi';
import { inspectionsRoutes } from '../../../server/api/inspections';
import { AIService } from '../../../server/services/ai.service';
import { InspectionService } from '../../../server/services/inspection.service';
import { ReportTranslationService } from '../../../server/services/report-translation.service';
import { RecordingAiProvider } from '../../../server/lib/ai/providers/recording';
import { segmentReport } from '../../../server/lib/translation/segment-report';
import { idempotencyMiddleware } from '../../../server/lib/middleware/idempotency';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';

const TENANT = '11111111-1111-4111-8111-111111111111';
const INSP_ID = '22222222-2222-4222-8222-222222222222';
const REPORT_ID = '33333333-3333-4333-8333-333333333333';

const SCHEMA = {
    schemaVersion: 2,
    sections: [{
        id: 'roof',
        title: 'Roof',
        items: [{ id: 'covering', label: 'Roof covering', type: 'rich' }],
    }],
};

let db: BetterSQLite3Database<typeof schema>;
let recorder: RecordingAiProvider;

/** A canned reply of exactly the right length — the seam refuses any other. */
const replyFor = (n: number) => JSON.stringify(Array.from({ length: n }, (_, i) => `ES-${i}`));

function buildApp() {
    const app = new OpenAPIHono<HonoConfig>();
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
        }
        return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
    });
    const services = {
        ai: new AIService(
            {} as D1Database, 'test-key', 'saas', 'test-model', undefined,
            { source: 'byo', tenantKeyAttested: true },
            { record: async () => 'ai-call-row' },
            undefined,
            recorder,
        ),
        inspection: new InspectionService({} as D1Database),
        reportTranslation: new ReportTranslationService({} as D1Database),
    } as unknown as HonoConfig['Variables']['services'];
    app.use('*', async (c, next) => {
        c.set('userRole', 'owner');
        c.set('tenantId', TENANT);
        c.set('user', { sub: 'u1' } as never);
        c.set('services', services);
        await next();
    });
    app.use('*', idempotencyMiddleware({ getDb: () => db as never }));
    app.route('/api/inspections', inspectionsRoutes);
    return app;
}

const ENV = { DB: {}, JWT_SECRET: 'test-secret', APP_BASE_URL: 'https://app.test' };
const EXEC = {
    waitUntil: (p: Promise<unknown>) => { void Promise.resolve(p).catch(() => {}); },
    passThroughOnException: () => {},
} as ExecutionContext;

function post(key: string | null, body: unknown) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (key) headers['Idempotency-Key'] = key;
    // The literal path, spelled out: `lint:idempotency` reads this file looking
    // for it, and a template string would not be found.
    return buildApp().request('/api/inspections/{id}/report-translation'
        .replace('{id}', INSP_ID), {
        method: 'POST', headers, body: JSON.stringify(body),
    }, ENV, EXEC);
}

beforeEach(async () => {
    const fixture = createTestDb();
    db = fixture.db;
    await setupSchema(fixture.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

    await db.insert(schema.tenants).values({
        id: TENANT, slug: 'a', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await db.insert(schema.tenantConfigs).values({
        tenantId: TENANT, courtesyTranslationEnabled: true,
        createdAt: new Date(), updatedAt: new Date(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    await db.insert(schema.templates).values({
        id: 'tpl-1', tenantId: TENANT, name: 'T', schema: SCHEMA,
        createdAt: new Date(), updatedAt: new Date(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    await db.insert(schema.inspections).values({
        id: INSP_ID, tenantId: TENANT, templateId: 'tpl-1', templateSnapshot: SCHEMA,
        propertyAddress: '1 Main St', date: '2026-06-01', status: 'completed',
        createdAt: new Date(), updatedAt: new Date(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    await db.insert(schema.reports).values({
        id: REPORT_ID, tenantId: TENANT, inspectionId: INSP_ID, kind: 'primary',
        title: 'Inspection report', status: 'published', createdAt: new Date(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    await db.insert(schema.inspectionResults).values({
        id: 'res-1', tenantId: TENANT, inspectionId: INSP_ID, reportId: REPORT_ID,
        data: { '_default:roof:covering': { rating: 'Defect', notes: 'Cracked flashing at the ridge.' } },
        createdAt: new Date(), updatedAt: new Date(), lastSyncedAt: new Date(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    // The reply has to be exactly as long as the segmenter's output: the seam
    // refuses any other length rather than mapping what it got. Derived from
    // the real payload, so a change to what the report carries cannot leave
    // this spec quietly passing a 503 around.
    const data = await new InspectionService({} as D1Database)
        .getReportData(INSP_ID, TENANT, (k) => k, undefined, undefined, REPORT_ID);
    recorder = new RecordingAiProvider([replyFor(segmentReport(data).length)]);
});

describe("POST '/api/inspections/{id}/report-translation' — a replay does not pay twice", () => {
    const BODY = { action: 'regenerate', locale: 'es-419' };

    it('calls the provider exactly once across two sends under one key', async () => {
        const first = await post('trans-1', BODY);
        const second = await post('trans-1', BODY);

        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        // The assertion that matters. The stored row looks identical either
        // way, so the only visible difference between one call and two is here.
        expect(recorder.requests).toHaveLength(1);
    });

    it('DOES call the provider again under a different key — the positive control', async () => {
        // Without this, a route that never reached the provider at all would
        // satisfy the assertion above.
        await post('trans-1', BODY);
        await post('trans-2', BODY);
        expect(recorder.requests).toHaveLength(2);
    });

    it('stores exactly one row either way', async () => {
        await post('trans-1', BODY);
        await post('trans-1', BODY);
        const rows = await db.select().from(schema.reportTranslations).all();
        expect(rows).toHaveLength(1);
    });
});
