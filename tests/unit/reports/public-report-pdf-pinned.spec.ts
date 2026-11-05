/**
 * The PDF a client downloads is the PUBLISHED version, rendered through a URL we build from the company's own row.
 *
 *  - pinned: the render URL carries a signed render token naming the latest published version, and the cache key is that version's own
 *    content hash, so an edit of the live tables cannot change what a client downloads;
 *  - the `:tenant` segment of the request is the caller's text and never reaches the URL the headless browser visits.
 *
 * Driven through the real application; only the browser render and the stored-file read are intercepted, so the assertions read the
 * arguments the renderer would have received.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { app } from '../../../server/index';
import { PortalAccessService } from '../../../server/services/portal-access.service';
import { ReportPdfService } from '../../../server/services/report-pdf.service';
import { resolveRenderAccess } from '../../../server/lib/render-token';
import * as schema from '../../../server/lib/db/schema';
import { makeExecutionContext } from '../helpers/exec-ctx';
import { createHarness, INSPECTOR_ID, TENANT_ID, TENANT_SLUG } from '../helpers/tenant-email-harness';

const ID = '44444444-0000-4000-8000-0000000000b1';
const SNAPSHOT = { schemaVersion: 2, sections: [{ id: 'sec_roof', title: 'Roof', items: [{ id: 'itm_cover', label: 'Roof cover', type: 'rich' }] }] };

interface RenderCall { reportUrl: string; contentHash: string; versionNumber: number | null; footer: unknown }

async function setup(opts: { versions?: Array<{ n: number; hash: string }> } = {}) {
    const h = await createHarness('standalone');
    await h.db.insert(schema.inspections).values({
        id: ID, tenantId: TENANT_ID, inspectorId: INSPECTOR_ID, propertyAddress: '500 Commerce Way', propertyType: 'single_family', date: '2026-11-01',
        status: 'completed', reportStatus: 'published', paymentStatus: 'paid', paymentRequired: false, agreementRequired: false, createdAt: new Date(),
        templateSnapshot: SNAPSHOT,
    } as never);
    for (const v of opts.versions ?? []) {
        await h.db.insert(schema.reportVersions).values({
            id: `rv-${v.n}`, tenantId: TENANT_ID, inspectionId: ID, versionNumber: v.n, snapshotJson: '{}', contentHash: v.hash,
            verificationToken: `vt-${v.n}`, publishedAt: new Date(), publishedBy: 'u1',
        } as never);
    }
    const token = await new PortalAccessService(h.env.DB, { jwtSecret: h.env.JWT_SECRET }).issueToken({ tenantId: TENANT_ID, inspectionId: ID, recipientEmail: 'client@example.test', role: 'client' });
    const calls: RenderCall[] = [];
    vi.spyOn(ReportPdfService.prototype, 'getOrRender').mockImplementation(async (_i, _t, _type, o) => {
        calls.push(o as unknown as RenderCall);
        return { status: 'ready', r2Key: 'k' } as never;
    });
    vi.spyOn(ReportPdfService.prototype, 'streamPdf').mockResolvedValue({ body: new Blob(['%PDF']).stream() } as never);
    const env = { ...h.env, BROWSER: {}, PHOTOS: {} } as typeof h.env;
    const get = async (segment: string, type = '') => {
        const exec = makeExecutionContext({ label: 'report-pdf' });
        const res = await app.request(`/api/public/report/${segment}/${ID}/pdf?token=${encodeURIComponent(token)}${type}`, { method: 'GET' }, env, exec.ctx);
        await exec.settle();
        return res;
    };
    return { h, calls, get };
}

afterEach(() => { vi.restoreAllMocks(); });

const renderToken = (url: string): string => new URL(url).searchParams.get('render') ?? '';

describe('the client PDF download', () => {
    it('renders the latest published version, keyed by that version\'s own content hash', async () => {
        const { h, calls, get } = await setup({ versions: [{ n: 1, hash: 'hash-v1' }, { n: 2, hash: 'hash-v2' }] });
        try {
            const res = await get(TENANT_SLUG);
            expect(res.status).toBe(200);
            expect(calls).toHaveLength(1);
            expect(calls[0]).toMatchObject({ contentHash: 'hash-v2', versionNumber: 2 });
            // The version travels inside the signed render token, the only place the page accepts one from.
            const access = await resolveRenderAccess(renderToken(calls[0]!.reportUrl), ID, h.env.JWT_SECRET);
            expect(access?.versionNumber).toBe(2);
            expect(calls[0]!.footer).toBeTruthy();
        } finally { h.close(); }
    }, 120_000);

    it('falls back to the live read for a report with no version row, naming no version', async () => {
        const { h, calls, get } = await setup();
        try {
            expect((await get(TENANT_SLUG)).status).toBe(200);
            expect(calls[0]!.versionNumber).toBeNull();
            expect(calls[0]!.contentHash).toMatch(/^[0-9a-f]{64}$/);
            expect((await resolveRenderAccess(renderToken(calls[0]!.reportUrl), ID, h.env.JWT_SECRET))?.versionNumber).toBeUndefined();
        } finally { h.close(); }
    }, 120_000);

    it('builds the render URL from the company slug, whatever the request\'s :tenant segment says', async () => {
        const { h, calls, get } = await setup({ versions: [{ n: 1, hash: 'hash-v1' }] });
        try {
            for (const segment of [TENANT_SLUG, 'someone-elses-slug', encodeURIComponent('x/../../api/auth/me?')]) {
                const res = await get(segment);
                expect(res.status, segment).toBe(200);
            }
            expect(calls).toHaveLength(3);
            for (const call of calls) {
                const url = new URL(call.reportUrl);
                expect(url.pathname, call.reportUrl).toBe(`/report-view/${TENANT_SLUG}/${ID}`);
                expect(url.searchParams.has('render')).toBe(true);
            }
        } finally { h.close(); }
    }, 120_000);
});

