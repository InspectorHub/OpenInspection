/**
 * The publish audit entry says WHAT was published and, for an amendment, the publisher's notify choice.
 *
 * History (F79): `POST /api/inspections/:id/publish` once copied `notifyClient` / `notifyAgent` out of the body into the
 * `inspection.published` audit metadata while nothing honoured them, so a publish marked "notify nobody" was recorded as
 * such while every rule fired. The fix removed the flags. `notifyClient` is back with a narrower meaning that the publish
 * service DOES honour: on an amendment it decides whether the report-updated rules fire. So the row records it for an
 * amendment only, and never records it for a first publish, where it changes nothing. `notifyAgent` is still not a field.
 *
 * ASSERTED AS KEY ABSENCE where absence is the claim (`in`, not a falsy value), PAIRED WITH A POSITIVE CONTROL: the row
 * must still be written and carry `reportId`, or a handler that stopped auditing would pass every negative assertion.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeExecutionContext } from '../helpers/exec-ctx';

const auditSpy = vi.fn();
vi.mock('../../../server/lib/audit', async (importActual) => ({
    ...(await importActual<Record<string, unknown>>()),
    auditFromContext: (...args: unknown[]) => auditSpy(...args),
}));

// The courtesy translation rides `waitUntil` and reaches out of process; it is
// not what this spec is about.
vi.mock('../../../server/lib/translation/on-publish', async (importActual) => ({
    ...(await importActual<Record<string, unknown>>()),
    translateOnPublishForRequest: () => Promise.resolve(),
}));

import { OpenAPIHono } from '@hono/zod-openapi';
import { inspectionsRoutes } from '../../../server/api/inspections';
import { AUDIT_REGISTRY } from '../../../server/lib/audit-registry';
import type { HonoConfig } from '../../../server/types/hono';

const TENANT = '00000000-0000-0000-0000-000000000001';
const USER_ID = '00000000-0000-0000-0000-000000000300';
const INSP_ID = '550e8400-e29b-41d4-a716-446655440000';

const EXEC_CTX = makeExecutionContext().ctx;

/**
 * The publish handler's collaborators, stubbed at the service boundary.
 *
 * `publishInspection` returns the shape the handler echoes back; the version
 * snapshot and the PDF pipeline are best-effort follow-on work the handler wraps
 * in its own try/catch, and `isPipelineEnabled: false` keeps the headless-render
 * branch out of the way.
 */
const publishInspection = vi.fn();
function buildApp() {
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('userRole', 'owner' as never);
        c.set('tenantId', TENANT);
        c.set('user', { sub: USER_ID } as never);
        c.set('services', {
            inspection: {
                publishInspection,
            },
            reportVersion: {
                assertSnapshotFits: vi.fn().mockResolvedValue(undefined),
                snapshotOnPublish: vi.fn().mockResolvedValue({ versionNumber: 1, contentHash: 'h1' }),
            },
            reportPdf: {
                purgeTransientPdfs: vi.fn().mockResolvedValue(undefined),
                isPipelineEnabled: vi.fn().mockResolvedValue(false),
            },
        } as never);
        await next();
    });
    app.route('/api/inspections', inspectionsRoutes);
    return app;
}

/** Publish with whatever body a caller chose to send. */
async function publish(body: Record<string, unknown>) {
    const res = await buildApp().request(
        `/api/inspections/${INSP_ID}/publish`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
        { DB: {}, JWT_SECRET: 'test-secret' },
        EXEC_CTX,
    );
    return { status: res.status, body: await res.json().catch(() => ({})) as Record<string, unknown> };
}

/** The metadata of the single `inspection.published` row this publish wrote. */
function publishedMetadata(): Record<string, unknown> {
    const call = auditSpy.mock.calls.find((args) => args[1] === 'inspection.published');
    expect(call, 'no inspection.published audit row was written').toBeTruthy();
    const opts = call![3] as { metadata?: Record<string, unknown> };
    return opts.metadata ?? {};
}

describe('publish audit metadata and the notify choice', () => {
    beforeEach(() => {
        auditSpy.mockClear();
        publishInspection.mockReset().mockResolvedValue({ reportUrl: `/report/acme/${INSP_ID}`, reportStatus: 'published', amendment: false });
    });

    // POSITIVE CONTROL. Most of what follows is an absence assertion; this proves the route ran and the row is written.
    it('still records the publish, naming the deliverable', async () => {
        const res = await publish({ reportId: 'report-1' });
        expect(res.status).toBe(200);
        expect(publishedMetadata().reportId).toBe('report-1');
    });

    it('a first publish records no notify choice, even when the caller posts one (it changes nothing there)', async () => {
        await publish({ reportId: 'report-1', notifyClient: true, notifyAgent: true });
        const metadata = publishedMetadata();
        expect(metadata.amendment).toBe(false);
        expect('notifyClient' in metadata).toBe(false);
        expect('notifyAgent' in metadata).toBe(false);
    });

    it.each([[true], [false]])('an amendment records the choice it was given (notifyClient %s)', async (choice) => {
        publishInspection.mockResolvedValue({ reportUrl: 'u', reportStatus: 'published', amendment: true });
        await publish({ reportId: 'report-1', notifyClient: choice });
        const metadata = publishedMetadata();
        expect(metadata.amendment).toBe(true);
        expect(metadata.notifyClient).toBe(choice);
        expect('notifyAgent' in metadata).toBe(false);
    });

    it('the choice reaches the service, defaults to false, and the internal amendment flag stays out of the response', async () => {
        publishInspection.mockResolvedValue({ reportUrl: 'u', reportStatus: 'published', amendment: true });
        const omitted = await publish({});
        expect(publishInspection.mock.calls.at(-1)![2]).toMatchObject({ notifyClient: false });
        const asked = await publish({ notifyClient: true });
        expect(publishInspection.mock.calls.at(-1)![2]).toMatchObject({ notifyClient: true });
        expect(omitted.body.data as object).not.toHaveProperty('amendment');
        expect(asked.body.data as object).toMatchObject({ reportUrl: 'u' });
    });

    it('the audit registry declares exactly what the row can carry', () => {
        const meta = AUDIT_REGISTRY['inspection.published'].meta;
        expect(Object.keys(meta).sort()).toEqual(['amendment', 'notifyClient', 'reportId']);
        expect('notifyAgent' in meta).toBe(false);
    });
});
