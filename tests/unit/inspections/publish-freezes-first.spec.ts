/**
 * Publishing freezes the report before it announces it.
 *
 * What a client reads from now on is the frozen copy of the report, so the publish route
 *
 *   1. refuses a report whose copy cannot be stored (over 1 MB) BEFORE anything is marked published, with a
 *      413 that names the size, instead of marking it published and then failing to freeze it;
 *   2. starts the courtesy translation only once the version exists, and hands it that version, so the
 *      translation is made from (and hashed on) the document the client will read;
 *   3. renders the PDFs of the publish pipeline from that version and stores them under its own hash.
 *
 * Each case is paired with the ordinary publish, so a route that never ran cannot pass.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeExecutionContext } from '../helpers/exec-ctx';

const order: string[] = [];
const translateSpy = vi.fn(async (...args: unknown[]) => { order.push('translate'); return args; });
vi.mock('../../../server/lib/translation/on-publish', async (importActual) => ({
    ...(await importActual<Record<string, unknown>>()),
    translateOnPublishForRequest: (...args: unknown[]) => translateSpy(...args),
}));
vi.mock('../../../server/lib/audit', async (importActual) => ({
    ...(await importActual<Record<string, unknown>>()),
    auditFromContext: () => undefined,
}));

import { OpenAPIHono } from '@hono/zod-openapi';
import { inspectionsRoutes } from '../../../server/api/inspections';
import { SnapshotTooLargeError } from '../../../server/lib/report-snapshot-build';
import { verifyRenderToken } from '../../../server/lib/render-token';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';

const TENANT = '00000000-0000-0000-0000-000000000001';
const USER_ID = '00000000-0000-0000-0000-000000000300';
const INSP_ID = '550e8400-e29b-41d4-a716-446655440000';

function harness(opts: { tooLarge?: boolean; pipeline?: boolean } = {}) {
    const exec = makeExecutionContext();
    const publishInspection = vi.fn(async () => { order.push('publish'); return { reportUrl: `/report/acme/${INSP_ID}`, reportStatus: 'published' }; });
    const assertSnapshotFits = vi.fn(async () => {
        order.push('fits');
        if (opts.tooLarge) throw new SnapshotTooLargeError(1_500_000);
    });
    const snapshotOnPublish = vi.fn(async () => { order.push('snapshot'); return { versionNumber: 4, contentHash: 'hash-of-v4' }; });
    const renderAndStore = vi.fn(async () => undefined);
    const getReportContentHash = vi.fn(async () => 'live-hash');
    const app = new OpenAPIHono<HonoConfig>();
    app.onError((err, c) => (err instanceof AppError
        ? c.json({ success: false, error: { code: err.code, message: err.message } }, err.status)
        : c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500)));
    app.use('*', async (c, next) => {
        c.set('userRole', 'owner' as never);
        c.set('tenantId', TENANT);
        c.set('user', { sub: USER_ID } as never);
        c.set('requestedTenantSlug', 'acme' as never);
        c.set('services', {
            inspection: { publishInspection, getReportContentHash, getReportPdfFooterContext: vi.fn(async () => ({})) },
            reportVersion: { assertSnapshotFits, snapshotOnPublish },
            reportPdf: {
                purgeTransientPdfs: vi.fn().mockResolvedValue(undefined),
                isPipelineEnabled: vi.fn().mockResolvedValue(opts.pipeline === true),
                markQueued: vi.fn().mockResolvedValue(undefined),
                renderAndStore,
            },
        } as never);
        await next();
    });
    app.route('/api/inspections', inspectionsRoutes);
    const publish = async (body: Record<string, unknown>) => {
        const res = await app.request(`/api/inspections/${INSP_ID}/publish`,
            { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
            { DB: {}, JWT_SECRET: 'test-secret' }, exec.ctx);
        await exec.settle();
        return { status: res.status, body: await res.json().catch(() => ({})) as { error?: { message?: string } } };
    };
    return { publish, publishInspection, snapshotOnPublish, renderAndStore, getReportContentHash };
}

describe('publish freezes the report first', () => {
    beforeEach(() => { order.length = 0; translateSpy.mockClear(); });

    it('refuses an oversized report with a 413 that names the size, before anything is published or frozen', async () => {
        const h = harness({ tooLarge: true });
        const res = await h.publish({ translateTo: 'es-419' });
        expect(res.status).toBe(413);
        expect(res.body.error?.message).toMatch(/too large to publish.*1\.43 MB.*limit is 1 MB/);
        expect(h.publishInspection).not.toHaveBeenCalled();
        expect(h.snapshotOnPublish).not.toHaveBeenCalled();
        expect(translateSpy).not.toHaveBeenCalled();
    });

    it('checks the size first, then publishes, then freezes, then starts the translation with the version', async () => {
        const h = harness();
        const res = await h.publish({ translateTo: 'es-419', reportId: 'report-1' });
        expect(res.status).toBe(200);
        expect(order).toEqual(['fits', 'publish', 'snapshot', 'translate']);
        // (c, inspectionId, locale, reportId, versionNumber)
        expect(translateSpy.mock.calls[0]!.slice(1)).toEqual([INSP_ID, 'es-419', 'report-1', 4]);
    });

    it('renders the pipeline PDFs from the frozen version and stores them under its own hash', async () => {
        const h = harness({ pipeline: true });
        const res = await h.publish({});
        expect(res.status).toBe(200);
        expect(h.renderAndStore).toHaveBeenCalledTimes(2);
        for (const call of h.renderAndStore.mock.calls as unknown as Array<[string, string, string, { reportUrl: string; versionNumber: number; contentHash: string }]>) {
            const opts = call[3];
            expect(opts.versionNumber).toBe(4);
            expect(opts.contentHash).toBe('hash-of-v4');
            const token = decodeURIComponent(new URL(opts.reportUrl).searchParams.get('render')!);
            expect(await verifyRenderToken(token, 'test-secret')).toMatchObject({ versionNumber: 4 });
        }
        expect(h.getReportContentHash).not.toHaveBeenCalled();
    });
});
