/**
 * F79 — the publish audit entry must not claim to know who was notified.
 *
 * `POST /api/inspections/:id/publish` used to copy `notifyClient` /
 * `notifyAgent` straight out of the request body into the `inspection.published`
 * audit metadata. Nothing read those flags: `publishInspection` takes them in its
 * options type and never looks at them, and who actually receives the report is
 * decided by the workspace's `report.published` automation rules. So a publish
 * marked "notify nobody" was RECORDED as having notified nobody while every rule
 * fired and the mail went out — the audit row said the opposite of what happened,
 * and the audit row is the artefact someone later reads to answer "who was told,
 * and when".
 *
 * The fix is subtraction: the flags are gone from the request schema, from the
 * service options, and from this row. An audit field that is always a guess is
 * worse than an absent one.
 *
 * ASSERTED AS KEY ABSENCE, not as a falsy value. `metadata.notifyClient ===
 * false` passes both for "the key is gone" and for "the key is still written and
 * happened to be false", which is the defect. Only `in` separates them.
 *
 * PAIRED WITH A POSITIVE CONTROL: the row must still be written, and must still
 * carry `reportId`. Without that, a handler that stopped auditing altogether —
 * or a harness whose route never ran — would pass every negative assertion here.
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
function buildApp() {
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('userRole', 'owner' as never);
        c.set('tenantId', TENANT);
        c.set('user', { sub: USER_ID } as never);
        c.set('services', {
            inspection: {
                publishInspection: vi.fn().mockResolvedValue({
                    reportUrl: `/report/acme/${INSP_ID}`, reportStatus: 'published',
                }),
            },
            reportVersion: {
                snapshotOnPublish: vi.fn().mockResolvedValue({ versionNumber: 1 }),
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

describe('F79 — publish audit metadata carries no notify flags', () => {
    beforeEach(() => { auditSpy.mockClear(); });

    // POSITIVE CONTROL. Everything below is an absence assertion; this is the
    // one that proves the route ran and the row is still being written.
    it('still records the publish, naming the deliverable', async () => {
        const res = await publish({ reportId: 'report-1' });
        expect(res.status).toBe(200);
        expect(publishedMetadata().reportId).toBe('report-1');
    });

    it('omits notifyClient / notifyAgent entirely', async () => {
        await publish({ reportId: 'report-1' });
        const metadata = publishedMetadata();
        expect('notifyClient' in metadata).toBe(false);
        expect('notifyAgent' in metadata).toBe(false);
    });

    // The interesting case, and the one the old row got exactly backwards: a
    // caller that still posts the flags must not have them echoed into the
    // record, because the record would then state a delivery decision nothing
    // in the service honoured.
    it('ignores the flags even when a caller still posts them', async () => {
        const res = await publish({ reportId: 'report-1', notifyClient: false, notifyAgent: false });
        expect(res.status).toBe(200);
        const metadata = publishedMetadata();
        expect('notifyClient' in metadata).toBe(false);
        expect('notifyAgent' in metadata).toBe(false);
    });

    /**
     * The registry is the authority on what a row carries — `lint:audit-registry`
     * walks it against the call sites in both directions — so it is asserted
     * against here rather than against a literal this spec chose for itself.
     */
    it('does not declare the flags in the audit registry', () => {
        const meta = AUDIT_REGISTRY['inspection.published'].meta;
        expect(Object.keys(meta)).toContain('reportId');
        expect('notifyClient' in meta).toBe(false);
        expect('notifyAgent' in meta).toBe(false);
    });
});
