/**
 * The video clip and poster a report link plays are served behind the same proof and gates as its photos.
 *
 * Driven through the real application over a bucket that serves real bytes, so a 404 cannot come from an empty bucket. Every refusal
 * sits beside a positive control on the same harness.
 */
import { describe, it, expect, vi } from 'vitest';
import { app } from '../../../server/index';
import { buildKeyring, signJwt } from '../../../server/lib/jwt-keyring';
import { PortalAccessService } from '../../../server/services/portal-access.service';
import { signRenderToken } from '../../../server/lib/render-token';
import { r2Keys } from '../../../server/lib/r2-keys';
import * as schema from '../../../server/lib/db/schema';
import { InspectionReportService } from '../../../server/services/inspection/inspection-report.service';
import { DefectCategoryService } from '../../../server/services/inspection/defect-category.service';
import { makeExecutionContext } from '../helpers/exec-ctx';
import { createHarness, INSPECTOR_ID, OWNER_ID, TENANT_ID, TENANT_SLUG, type Harness } from '../helpers/tenant-email-harness';

const ID = '44444444-0000-4000-8000-0000000000a1';
const OTHER_ID = '44444444-0000-4000-8000-0000000000a2';
const MEDIA = 'media-v1';
const CLIP = r2Keys.inspectionVideo(TENANT_ID, ID, MEDIA, 'mp4');
const POSTER = r2Keys.inspectionVideoPoster(TENANT_ID, ID, MEDIA);
const CLIP_BYTES = new Uint8Array(100).map((_, i) => i);
const POSTER_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]);
const SNAPSHOT = { schemaVersion: 2, sections: [{ id: 'sec_roof', title: 'Roof', items: [{ id: 'itm_cover', label: 'Roof cover', type: 'rich' }] }] };
const base = `/api/public/report/${TENANT_SLUG}/${ID}/video/r2-object`;

interface Stored { bytes: Uint8Array; type: string }

function bucket(objects: Map<string, Stored>): R2Bucket {
    return {
        head: async (key: string) => {
            const o = objects.get(key);
            return o ? { size: o.bytes.length } : null;
        },
        get: async (key: string, options?: { range?: { offset: number; length?: number } }) => {
            const o = objects.get(key);
            if (!o) return null;
            const r = options?.range;
            const bytes = r ? o.bytes.slice(r.offset, r.length === undefined ? undefined : r.offset + r.length) : o.bytes;
            return { body: new Blob([new Uint8Array(bytes)]).stream(), size: o.bytes.length, httpMetadata: { contentType: o.type } };
        },
    } as unknown as R2Bucket;
}

async function setup() {
    const h = await createHarness('standalone');
    const insp = (id: string) => ({
        id, tenantId: TENANT_ID, inspectorId: INSPECTOR_ID, propertyAddress: '500 Commerce Way', propertyType: 'single_family', date: '2026-11-01',
        status: 'completed', reportStatus: 'published', paymentStatus: 'paid', paymentRequired: false, agreementRequired: false, createdAt: new Date(),
        templateSnapshot: SNAPSHOT,
    });
    await h.db.insert(schema.inspections).values([insp(ID), insp(OTHER_ID)] as never);
    await h.db.insert(schema.inspectionResults).values({
        id: 'res-v1', tenantId: TENANT_ID, inspectionId: ID, lastSyncedAt: new Date(),
        data: { itm_cover: { rating: 'satisfactory', photos: [{ key: CLIP, mediaType: 'video', provider: 'r2', mediaId: MEDIA, posterKey: POSTER }] } },
    });
    await h.db.insert(schema.inspectionMediaPool).values({
        id: MEDIA, inspectionId: ID, tenantId: TENANT_ID, r2Key: CLIP, posterKey: POSTER, url: '', uploadedAt: new Date(), mediaType: 'video', provider: 'r2',
    } as never);
    const objects = new Map<string, Stored>([[CLIP, { bytes: CLIP_BYTES, type: 'video/mp4' }], [POSTER, { bytes: POSTER_BYTES, type: 'image/jpeg' }]]);
    const env = { ...h.env, PHOTOS: bucket(objects) } as typeof h.env;
    const call = async (path: string, headers: Record<string, string> = {}) => {
        const exec = makeExecutionContext({ label: 'report-video' });
        const res = await app.request(path, { method: 'GET', headers }, env, exec.ctx);
        await exec.settle();
        return res;
    };
    return { h, call };
}

async function proofs(h: Harness) {
    const access = new PortalAccessService(h.env.DB, { jwtSecret: h.env.JWT_SECRET });
    const token = await access.issueToken({ tenantId: TENANT_ID, inspectionId: ID, recipientEmail: 'client@example.test', role: 'client' });
    const keyring = await buildKeyring(h.env as unknown as Record<string, string | undefined>);
    const now = Math.floor(Date.now() / 1000);
    const jwt = await signJwt({ sub: OWNER_ID, 'custom:tenantId': TENANT_ID, 'custom:userRole': 'owner', iat: now, exp: now + 3600 }, keyring);
    const render = await signRenderToken(ID, h.env.JWT_SECRET);
    return { token: `token=${encodeURIComponent(token)}`, render: `render=${encodeURIComponent(render)}`, owner: { authorization: `Bearer ${jwt}` } };
}

describe('the report video routes', () => {
    it('serve the clip and the poster to a portal token, a render token and an owner session, and to nobody else', async () => {
        const { h, call } = await setup();
        try {
            const p = await proofs(h);
            for (const [name, url, headers] of [
                ['token', `${base}/${MEDIA}?${p.token}`, {}], ['render', `${base}/${MEDIA}?${p.render}`, {}], ['owner', `${base}/${MEDIA}`, p.owner],
            ] as const) {
                const res = await call(url, headers);
                expect(res.status, name).toBe(200);
                expect(new Uint8Array(await res.arrayBuffer()), name).toEqual(CLIP_BYTES);
                expect(res.headers.get('cache-control'), name).toBe('private, max-age=300');
            }
            const poster = await call(`${base}/${MEDIA}/poster?${p.token}`);
            expect(poster.status).toBe(200);
            expect(new Uint8Array(await poster.arrayBuffer())).toEqual(POSTER_BYTES);
            expect(poster.headers.get('cache-control')).toBe('private, max-age=300');
            // The media id alone is not a credential.
            expect((await call(`${base}/${MEDIA}`)).status).toBe(404);
            expect((await call(`${base}/${MEDIA}/poster`)).status).toBe(404);
            expect((await call(`${base}/${MEDIA}?token=nonsense`)).status).toBe(404);
        } finally { h.close(); }
    }, 120_000);

    it('apply the publish and release gates, and a token for another inspection', async () => {
        const { h, call } = await setup();
        try {
            const p = await proofs(h);
            const clip = `${base}/${MEDIA}?${p.token}`;
            expect((await call(clip)).status).toBe(200);
            // A token for this inspection does not open another inspection's clip.
            expect((await call(`/api/public/report/${TENANT_SLUG}/${OTHER_ID}/video/r2-object/${MEDIA}?${p.token}`)).status).toBe(404);
            await h.db.update(schema.inspections).set({ paymentRequired: true, paymentStatus: 'unpaid' } as never);
            expect((await call(clip)).status).toBe(404);
            expect((await call(`${base}/${MEDIA}/poster?${p.token}`)).status).toBe(404);
            // The owner preview and the renderer are not held back, as on the photo route.
            expect((await call(`${base}/${MEDIA}`, p.owner)).status).toBe(200);
            await h.db.update(schema.inspections).set({ paymentRequired: false } as never);
            expect((await call(clip)).status).toBe(200);
            await h.db.update(schema.inspections).set({ reportStatus: 'draft' } as never);
            expect((await call(clip)).status).toBe(404);
            expect((await call(`${base}/${MEDIA}`, p.owner)).status).toBe(200);
        } finally { h.close(); }
    }, 120_000);

    it('answer Range requests with the right bytes, headers and statuses', async () => {
        const { h, call } = await setup();
        try {
            const url = `${base}/${MEDIA}?${(await proofs(h)).token}`;
            const ranged = async (range: string) => call(url, { Range: range });
            const mid = await ranged('bytes=10-29');
            expect(mid.status).toBe(206);
            expect(mid.headers.get('content-range')).toBe('bytes 10-29/100');
            expect(mid.headers.get('content-length')).toBe('20');
            expect(new Uint8Array(await mid.arrayBuffer())).toEqual(CLIP_BYTES.slice(10, 30));
            // An end past the object is clamped to the real last byte, and the length is the real one.
            const past = await ranged('bytes=90-500');
            expect(past.status).toBe(206);
            expect(past.headers.get('content-range')).toBe('bytes 90-99/100');
            expect(past.headers.get('content-length')).toBe('10');
            expect(new Uint8Array(await past.arrayBuffer())).toEqual(CLIP_BYTES.slice(90));
            // Open-ended and suffix forms (players ask for the tail to find the end of a clip).
            const open = await ranged('bytes=95-');
            expect(open.headers.get('content-range')).toBe('bytes 95-99/100');
            const tail = await ranged('bytes=-4');
            expect(tail.status).toBe(206);
            expect(tail.headers.get('content-range')).toBe('bytes 96-99/100');
            expect(new Uint8Array(await tail.arrayBuffer())).toEqual(CLIP_BYTES.slice(96));
            // A start at or past the end is unsatisfiable and says how long the object is.
            const beyond = await ranged('bytes=100-');
            expect(beyond.status).toBe(416);
            expect(beyond.headers.get('content-range')).toBe('bytes */100');
            // A form we do not serve is ignored, not an error: the whole clip comes back.
            const multi = await ranged('bytes=0-1,5-6');
            expect(multi.status).toBe(200);
            expect(new Uint8Array(await multi.arrayBuffer())).toEqual(CLIP_BYTES);
        } finally { h.close(); }
    }, 120_000);
});

describe('the staff video routes', () => {
    it('no longer answer without a session, and still answer with one', async () => {
        const { h, call } = await setup();
        try {
            const p = await proofs(h);
            const staff = `/api/inspections/${ID}/media/video/r2-object/${MEDIA}`;
            expect((await call(staff)).status).toBe(401);
            expect((await call(`${staff}/poster`)).status).toBe(401);
            expect((await call(staff, p.owner)).status).toBe(200);
            expect((await call(`${staff}/poster`, p.owner)).status).toBe(200);
        } finally { h.close(); }
    }, 120_000);
});

describe('the report response', () => {
    it('states the video URLs on the token-gated routes, each carrying the proof of its mode, and they play', async () => {
        const { h, call } = await setup();
        try {
            const p = await proofs(h);
            const report = `/api/public/report/${TENANT_SLUG}/${ID}`;
            for (const [name, url, headers, proof] of [
                ['token', `${report}?${p.token}`, {}, p.token], ['render', `${report}?${p.render}`, {}, p.render], ['owner', report, p.owner, ''],
            ] as const) {
                const text = await (await call(url, headers)).text();
                expect(text, name).not.toContain('/api/inspections/');
                const clip = text.match(/\/api\/public\/report\/[^"]*\/video\/r2-object\/[^"/?]+(\/poster)?(\?[^"]*)?(?=")/g) ?? [];
                expect(clip.length, name).toBeGreaterThan(0);
                for (const u of clip) {
                    if (proof) expect(u, name).toContain(proof);
                    const res = await call(u, headers);
                    expect(res.status, `${name} ${u}`).toBe(200);
                }
            }
        } finally { h.close(); }
    }, 120_000);
});

describe('reading a report is a read', () => {
    it('builds the report once per view and writes no defect categories for a company that has none yet', async () => {
        const { h, call } = await setup();
        const spy = vi.spyOn(InspectionReportService.prototype, 'getReportData');
        try {
            const p = await proofs(h);
            const count = async () => (await h.db.select().from(schema.defectCategories)).length;
            expect(await count()).toBe(0);
            const res = await call(`/api/public/report/${TENANT_SLUG}/${ID}?${p.token}`);
            expect(res.status).toBe(200);
            expect(spy).toHaveBeenCalledTimes(1);
            expect(await count()).toBe(0);
            // Control: the staff category list is the deliberate place that seeds, so the zero above is not a broken table.
            await new DefectCategoryService(h.env.DB).ensureSeed(TENANT_ID);
            expect(await count()).toBe(3);
        } finally { spy.mockRestore(); h.close(); }
    }, 120_000);
});

describe('the report video routes — branches', () => {
    it('serve a legacy share link, and refuse a render token minted for another inspection', async () => {
        const { h, call } = await setup();
        try {
            const p = await proofs(h);
            // A share link minted from the report page (the legacy agent-view token) opens the clip like a portal token does.
            const shareRes = await app.request(`/api/public/inspections/${ID}/share-token?${p.token}`, { method: 'POST' }, h.env, makeExecutionContext({ label: 'share' }).ctx);
            expect(shareRes.status).toBe(200);
            const shareToken = ((await shareRes.json()) as { data: { token: string } }).data.token;
            expect((await call(`${base}/${MEDIA}?token=${encodeURIComponent(shareToken)}`)).status).toBe(200);
            // Control: the same route refuses a render token whose inspection is another one.
            const foreign = await signRenderToken(OTHER_ID, h.env.JWT_SECRET);
            expect((await call(`${base}/${MEDIA}?render=${encodeURIComponent(foreign)}`)).status).toBe(404);
            expect((await call(`${base}/${MEDIA}?${p.render}`)).status).toBe(200);
        } finally { h.close(); }
    }, 120_000);

    it('refuse another company\'s owner session and a pool row that names another company, each beside its control', async () => {
        const { h, call } = await setup();
        try {
            const p = await proofs(h);
            const keyring = await buildKeyring(h.env as unknown as Record<string, string | undefined>);
            const now = Math.floor(Date.now() / 1000);
            const foreign = await signJwt({ sub: OWNER_ID, 'custom:tenantId': '99999999-0000-4000-8000-000000000009', 'custom:userRole': 'owner', iat: now, exp: now + 3600 }, keyring);
            // Controls: the company's own owner session and token open the clip.
            expect((await call(`${base}/${MEDIA}`, p.owner)).status).toBe(200);
            expect((await call(`${base}/${MEDIA}/poster`, p.owner)).status).toBe(200);
            // Another company's owner reaches no bytes through this inspection's link, as a bearer header or as the browser's cookie.
            for (const headers of [{ authorization: `Bearer ${foreign}` }, { cookie: `__Host-inspector_token=${foreign}` }] as Array<Record<string, string>>) {
                for (const path of [`${base}/${MEDIA}`, `${base}/${MEDIA}/poster`]) {
                    const res = await call(path, headers);
                    expect([401, 404], path).toContain(res.status);
                    expect((await res.arrayBuffer()).byteLength, path).toBeLessThan(CLIP_BYTES.length);
                }
            }
            // A pool row whose company is not the inspection's company is not served to the inspection's own token.
            await h.db.update(schema.inspectionMediaPool).set({ tenantId: '99999999-0000-4000-8000-000000000009' } as never);
            expect((await call(`${base}/${MEDIA}?${p.token}`)).status).toBe(404);
            expect((await call(`${base}/${MEDIA}/poster?${p.token}`)).status).toBe(404);
            expect((await call(`${base}/${MEDIA}`, p.owner)).status).toBe(404);
        } finally { h.close(); }
    }, 120_000);

    it('answer 404 for a media id that is not a video of this inspection, and for a clip whose file is gone', async () => {
        const { h, call } = await setup();
        try {
            const p = await proofs(h);
            expect((await call(`${base}/no-such-media?${p.token}`)).status).toBe(404);
            expect((await call(`${base}/no-such-media/poster?${p.token}`)).status).toBe(404);
            // The pool row of another inspection is not reachable through this inspection's link.
            await h.db.update(schema.inspectionMediaPool).set({ inspectionId: OTHER_ID } as never);
            expect((await call(`${base}/${MEDIA}?${p.token}`)).status).toBe(404);
            expect((await call(`${base}/${MEDIA}/poster?${p.token}`)).status).toBe(404);
        } finally { h.close(); }
    }, 120_000);
});
