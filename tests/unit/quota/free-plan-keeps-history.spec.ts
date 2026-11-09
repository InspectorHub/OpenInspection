/**
 * A company whose paid plan ended (tier 'free') keeps viewing and downloading its history, even with more
 * active members than its seat limit and past its monthly allowance of new inspections.
 *
 * Driven through the real application (real middleware chain, in-memory database presented as D1). Only the
 * headless-browser PDF render and the stored-file bucket are intercepted. The refusals at the bottom run on the
 * SAME company, so a harness that refuses everything, or allows everything, cannot pass both halves.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { app } from '../../../server/index';
import { buildKeyring, signJwt } from '../../../server/lib/jwt-keyring';
import { PortalAccessService } from '../../../server/services/portal-access.service';
import { ReportPdfService } from '../../../server/services/report-pdf.service';
import { r2Keys } from '../../../server/lib/r2-keys';
import { getSeatUsage } from '../../../server/features/seat-quota';
import { FREE_TIER_CAPS } from '../../../server/features/plan-quota/policy';
import * as schema from '../../../server/lib/db/schema';
import { makeExecutionContext } from '../helpers/exec-ctx';
import { createHarness, OWNER_ID, TENANT_ID, TENANT_SLUG, type Harness } from '../helpers/tenant-email-harness';

const REPORT_ID = '55555555-0000-4000-8000-0000000000c1';
const MEDIA = 'media-keep';
const CLIP = r2Keys.inspectionVideo(TENANT_ID, REPORT_ID, MEDIA, 'mp4');
const CLIP_BYTES = new Uint8Array(40).map((_, i) => i);
const TEMPLATE_ID = 'tpl-keep';
const SNAPSHOT = { schemaVersion: 2, sections: [{ id: 'sec_roof', title: 'Roof', items: [{ id: 'itm_cover', label: 'Roof cover', type: 'rich' }] }] };
const EXTRA_MEMBERS = 6; // owner + inspector from the harness + 6 = 8 active members on a 5-seat company

afterEach(() => { vi.restoreAllMocks(); });

function bucket(): R2Bucket {
    const has = (key: string) => key === CLIP;
    return {
        head: async (key: string) => (has(key) ? { size: CLIP_BYTES.length } : null),
        get: async (key: string) => (has(key)
            ? { body: new Blob([CLIP_BYTES]).stream(), size: CLIP_BYTES.length, httpMetadata: { contentType: 'video/mp4' } }
            : null),
    } as unknown as R2Bucket;
}

async function setup() {
    const h = await createHarness('saas');
    const now = new Date();
    // More active members than seats.
    await h.db.insert(schema.users).values(Array.from({ length: EXTRA_MEMBERS }, (_, i) => ({
        id: `66666666-0000-4000-8000-00000000000${i}`, tenantId: TENANT_ID, email: `member${i}@harbor-light.test`,
        passwordHash: 'h', role: 'manager', name: `Member ${i}`, createdAt: now,
    })) as never);
    await h.db.insert(schema.templates).values({
        id: TEMPLATE_ID, tenantId: TENANT_ID, name: 'Standard', schema: { sections: [] }, version: 1, createdAt: now,
    } as typeof schema.templates.$inferInsert);
    // One published report, plus enough inspections created this month to be past the allowance.
    const row = (id: string, published: boolean) => ({
        id, tenantId: TENANT_ID, propertyAddress: `${id.slice(-2)} Main St`, propertyType: 'single_family', date: '2026-11-01',
        status: 'completed', reportStatus: published ? 'published' : 'draft', paymentStatus: 'paid', paymentRequired: false,
        agreementRequired: false, createdAt: now, templateSnapshot: SNAPSHOT,
    });
    await h.db.insert(schema.inspections).values([
        row(REPORT_ID, true),
        ...Array.from({ length: FREE_TIER_CAPS.inspections }, (_, i) => row(`77777777-0000-4000-8000-0000000000d${i}`, false)),
    ] as never);
    await h.db.insert(schema.inspectionResults).values({
        id: 'res-keep', tenantId: TENANT_ID, inspectionId: REPORT_ID, lastSyncedAt: now,
        data: { itm_cover: { rating: 'satisfactory', photos: [{ key: CLIP, mediaType: 'video', provider: 'r2', mediaId: MEDIA }] } },
    });
    await h.db.insert(schema.inspectionMediaPool).values({
        id: MEDIA, inspectionId: REPORT_ID, tenantId: TENANT_ID, r2Key: CLIP, url: '', uploadedAt: now, mediaType: 'video', provider: 'r2',
    } as never);
    const token = await new PortalAccessService(h.env.DB, { jwtSecret: h.env.JWT_SECRET })
        .issueToken({ tenantId: TENANT_ID, inspectionId: REPORT_ID, recipientEmail: 'client@example.test', role: 'client' });

    vi.spyOn(ReportPdfService.prototype, 'getOrRender').mockResolvedValue({ status: 'ready', r2Key: 'k' } as never);
    vi.spyOn(ReportPdfService.prototype, 'streamPdf').mockResolvedValue({ body: new Blob(['%PDF']).stream() } as never);
    const env = { ...h.env, BROWSER: {}, PHOTOS: bucket() } as typeof h.env;

    const jwtFor = async (sub: string, role: string) => {
        const keyring = await buildKeyring(h.env as unknown as Record<string, string | undefined>);
        const iat = Math.floor(Date.now() / 1000);
        return signJwt({ sub, role, 'custom:userRole': role, 'custom:tenantId': TENANT_ID, iat, exp: iat + 3600 }, keyring);
    };
    const call = async (path: string, opts: { as?: string; method?: string; body?: unknown } = {}) => {
        const headers: Record<string, string> = {};
        if (opts.as) headers['authorization'] = `Bearer ${opts.as}`;
        if (opts.body !== undefined) headers['content-type'] = 'application/json';
        const exec = makeExecutionContext({ label: 'free-plan-keeps-history' });
        const res = await app.request(path, {
            method: opts.method ?? 'GET', headers, ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
        }, env, exec.ctx);
        await exec.settle();
        return res;
    };
    return { h, call, jwtFor, token: encodeURIComponent(token) };
}

async function countRows(h: Harness) {
    const seats = await getSeatUsage(TENANT_ID, h.env.DB);
    const tenant = (await h.db.select().from(schema.tenants).all())[0]!;
    const monthInspections = (await h.db.select().from(schema.inspections).all()).length;
    return { members: seats.members, maxUsers: seats.max, tier: tenant.tier, monthInspections };
}

describe('a free-plan company over its seat count and allowance', () => {
    it('is really over both limits (so the reads below are not an under-limit pass)', async () => {
        const { h } = await setup();
        try {
            const s = await countRows(h);
            console.info(`[free-plan-keeps-history] tier ${s.tier}, members ${s.members} / max_users ${s.maxUsers}, inspections this month ${s.monthInspections} / cap ${FREE_TIER_CAPS.inspections}`);
            expect(s.tier).toBe('free');
            expect(s.maxUsers).not.toBeNull();
            expect(s.members).toBeGreaterThan(s.maxUsers ?? Number.POSITIVE_INFINITY);
            expect(s.monthInspections).toBeGreaterThan(FREE_TIER_CAPS.inspections);
        } finally { h.close(); }
    }, 120_000);

    it('lets every member, including those past the seat count, read inspections', async () => {
        const { h, call, jwtFor } = await setup();
        try {
            for (let i = 0; i < EXTRA_MEMBERS; i++) {
                const jwt = await jwtFor(`66666666-0000-4000-8000-00000000000${i}`, 'manager');
                const list = await call('/api/inspections', { as: jwt });
                expect(list.status, `member ${i} list`).toBe(200);
                expect(await list.text(), `member ${i} list body`).toContain(REPORT_ID);
                expect((await call(`/api/inspections/${REPORT_ID}`, { as: jwt })).status, `member ${i} detail`).toBe(200);
            }
        } finally { h.close(); }
    }, 120_000);

    it('lets the owner export the company data as JSON', async () => {
        const { h, call, jwtFor } = await setup();
        try {
            const res = await call('/api/admin/export', { as: await jwtFor(OWNER_ID, 'owner') });
            expect(res.status).toBe(200);
            expect(await res.text()).toContain(REPORT_ID);
        } finally { h.close(); }
    }, 120_000);

    it('serves the published report link and video, and the PDF route admits the request (the renderer is stubbed)', async () => {
        const { h, call, token } = await setup();
        try {
            const report = `/api/public/report/${TENANT_SLUG}/${REPORT_ID}`;
            const page = await call(`${report}?token=${token}`);
            expect(page.status, 'report').toBe(200);
            expect((await call(`${report}/pdf?token=${token}`)).status, 'pdf').toBe(200);
            const clip = await call(`${report}/video/r2-object/${MEDIA}?token=${token}`);
            expect(clip.status, 'video').toBe(200);
            expect(new Uint8Array(await clip.arrayBuffer())).toEqual(CLIP_BYTES);
        } finally { h.close(); }
    }, 120_000);

    it('is still refused what the plan does limit: a new inspection past the allowance, and a new seat', async () => {
        const { h, call, jwtFor } = await setup();
        try {
            const owner = await jwtFor(OWNER_ID, 'owner');
            const create = await call('/api/inspections', {
                as: owner, method: 'POST',
                body: { propertyAddress: '9 New St', templateId: TEMPLATE_ID, date: '2026-11-20T10:00:00.000Z', client: { name: 'Pat', email: 'pat@client.test', phone: '555-0100' } },
            });
            expect(create.status, 'create').toBe(402);
            expect(((await create.json()) as { error?: { code?: string } }).error?.code).toBe('QUOTA_EXHAUSTED');

            const invite = await call('/api/team/invite', { as: owner, method: 'POST', body: { email: 'new@harbor-light.test', role: 'inspector' } });
            expect(invite.status, 'invite').toBe(402);
            expect(((await invite.json()) as { error?: { code?: string } }).error?.code).toBe('seat_limit_reached');
        } finally { h.close(); }
    }, 120_000);
});
