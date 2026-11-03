/**
 * A report link response states its storage keys relative to the company, and the photo route resolves them.
 *
 * Driven through the real application with an in-memory bucket that serves real objects, so a 404 cannot come from an empty bucket. Asked:
 *  - does any carrier of the response (the whole body, every access mode) still hold the company id, raw or percent-encoded?
 *  - does the photo URL the response carries return the bytes, in the relative form the response states and in the full form older links carry?
 *  - does the ownership check stay strict on the full key?
 * Each refusal sits beside a positive control on the same harness.
 */
import { describe, it, expect } from 'vitest';
import { app } from '../../../server/index';
import { buildKeyring, signJwt } from '../../../server/lib/jwt-keyring';
import { PortalAccessService } from '../../../server/services/portal-access.service';
import { signRenderToken } from '../../../server/lib/render-token';
import { projectReportForLink } from '../../../server/lib/report-link-response';
import { relativizeSerialized } from '../../../server/lib/report-link-keys';
import type { ReportData } from '../../../server/lib/translation/report-span-register';
import * as schema from '../../../server/lib/db/schema';
import { makeExecutionContext } from '../helpers/exec-ctx';
import { createHarness, INSPECTOR_ID, OWNER_ID, TENANT_ID, TENANT_SLUG, type Harness } from '../helpers/tenant-email-harness';

const ID = '44444444-0000-4000-8000-0000000000f1';
const OTHER_ID = '44444444-0000-4000-8000-0000000000f2';
const OTHER_TENANT = '11111111-0000-4000-8000-0000000000ff';
const KEY = `${TENANT_ID}/inspections/${ID}/photos/p1.jpg`;
const POSTER = `${TENANT_ID}/inspections/${ID}/photos/poster.jpg`;
const REL_KEY = `inspections/${ID}/photos/p1.jpg`;
const LOGO = `${TENANT_ID}/credentials/${INSPECTOR_ID}/logo-1.png`;
const BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7]);
const SNAPSHOT = { schemaVersion: 2, sections: [{ id: 'sec_roof', title: 'Roof', items: [{ id: 'itm_cover', label: 'Roof cover', type: 'rich' }] }] };

interface StoredObject { bytes: Uint8Array; type: string }
const SVG_LOGO = `${TENANT_ID}/credentials/${INSPECTOR_ID}/logo-2.svg`;
const SVG_BYTES = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
const THUMB = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1]);

function bucket(objects: Map<string, StoredObject>): R2Bucket {
    return {
        get: async (key: string) => {
            const stored = objects.get(key);
            if (!stored) return null;
            return { body: new Blob([new Uint8Array(stored.bytes)]).stream(), httpMetadata: { contentType: stored.type }, customMetadata: { originalName: 'roof.jpg' }, httpEtag: '"e"' };
        },
    } as unknown as R2Bucket;
}

/** An Images binding that records the widths it was asked for and answers a webp. */
function images(widths: number[]) {
    return {
        input: () => ({
            transform: (o: { width: number }) => {
                widths.push(o.width);
                return { output: async () => ({ response: () => new Response(THUMB, { headers: { 'Content-Type': 'image/webp' } }) }) };
            },
        }),
    };
}

async function setup() {
    const h = await createHarness('standalone');
    await h.db.insert(schema.inspections).values({
        id: ID, tenantId: TENANT_ID, inspectorId: INSPECTOR_ID, propertyAddress: '500 Commerce Way', propertyType: 'single_family', date: '2026-11-01',
        status: 'completed', reportStatus: 'published', paymentStatus: 'paid', paymentRequired: false, agreementRequired: false, createdAt: new Date(),
        templateSnapshot: SNAPSHOT, coverPhotoId: KEY,
    } as never);
    await h.db.insert(schema.inspectionResults).values({
        id: 'res-f1', tenantId: TENANT_ID, inspectionId: ID, lastSyncedAt: new Date(),
        data: {
            _inspector_signature: { signatureBase64: 'data:image/png;base64,iVBORw0KGgo=', signedAt: Date.now() },
            itm_cover: {
                rating: 'satisfactory', notes: 'ok',
                photos: [
                    { key: KEY },
                    { key: `${TENANT_ID}/inspections/${ID}/photos/clip.mp4`, mediaType: 'video', provider: 'r2', mediaId: 'media-v1', posterKey: POSTER },
                ],
                original: { rating: 'poor', notes: 'earlier', photos: [{ key: KEY }] },
            },
        },
    });
    await h.db.insert(schema.inspectorCredentials).values({
        id: 'cred-f1', tenantId: TENANT_ID, userId: INSPECTOR_ID, label: 'CPI', memberNumber: '1', imageR2Key: LOGO, sortOrder: 1, active: true, createdAt: new Date(), updatedAt: new Date(),
    });
    const objects = new Map<string, StoredObject>([
        [KEY, { bytes: BYTES, type: 'image/jpeg' }], [POSTER, { bytes: BYTES, type: 'image/jpeg' }],
        [LOGO, { bytes: BYTES, type: 'image/png' }], [SVG_LOGO, { bytes: SVG_BYTES, type: 'image/svg+xml' }],
    ]);
    const widths: number[] = [];
    const env = { ...h.env, PHOTOS: bucket(objects), IMAGES: images(widths) } as typeof h.env;
    const call = async (path: string, headers: Record<string, string> = {}) => {
        const exec = makeExecutionContext({ label: 'report-link-keys' });
        const res = await app.request(path, { method: 'GET', headers }, env, exec.ctx);
        await exec.settle();
        return res;
    };
    return { h, call, widths };
}

async function accessModes(h: Harness) {
    const access = new PortalAccessService(h.env.DB, { jwtSecret: h.env.JWT_SECRET });
    const client = await access.issueToken({ tenantId: TENANT_ID, inspectionId: ID, recipientEmail: 'client@example.test', role: 'client' });
    const agent = await access.issueToken({ tenantId: TENANT_ID, inspectionId: ID, recipientEmail: 'agent@example.test', role: 'buyer_agent' });
    const keyring = await buildKeyring(h.env as unknown as Record<string, string | undefined>);
    const now = Math.floor(Date.now() / 1000);
    const jwt = await signJwt({ sub: OWNER_ID, 'custom:tenantId': TENANT_ID, 'custom:userRole': 'owner', iat: now, exp: now + 3600 }, keyring);
    const render = await signRenderToken(ID, h.env.JWT_SECRET);
    const q = (name: string, value: string) => `${name}=${encodeURIComponent(value)}`;
    const base = `/api/public/report/${TENANT_SLUG}/${ID}`;
    return {
        client: { report: `${base}?${q('token', client)}`, photo: `${q('token', client)}`, headers: {} as Record<string, string> },
        agent: { report: `${base}?${q('token', agent)}`, photo: `${q('token', agent)}`, headers: {} as Record<string, string> },
        owner: { report: base, photo: '', headers: { authorization: `Bearer ${jwt}` } },
        render: { report: `${base}?${q('render', render)}`, photo: `${q('render', render)}`, headers: {} as Record<string, string> },
    };
}

/** Every path in a JSON value whose string holds the id, raw or percent-encoded. */
function carriers(value: unknown, id: string, path = '$'): string[] {
    const hit = (s: string): boolean => s.includes(id) || s.toLowerCase().includes(encodeURIComponent(id).toLowerCase());
    if (typeof value === 'string') return hit(value) ? [path] : [];
    if (Array.isArray(value)) return value.flatMap((v, i) => carriers(v, id, `${path}[${i}]`));
    if (value !== null && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => carriers(v, id, `${path}.${k}`));
    return [];
}

describe('the report link response carries no company id', () => {
    it.each(['client', 'agent', 'owner', 'render'] as const)('%s access: no string anywhere in the body holds the company id', async (mode) => {
        const { h, call } = await setup();
        try {
            const access = (await accessModes(h))[mode];
            const res = await call(access.report, access.headers);
            expect(res.status, await res.clone().text()).toBe(200);
            const text = await res.text();
            expect(carriers(JSON.parse(text), TENANT_ID)).toEqual([]);
            expect(text).not.toContain(TENANT_ID);
            expect(text.toLowerCase()).not.toContain(encodeURIComponent(TENANT_ID).toLowerCase());
            // Control: the body does state the photos and the signature it was seeded with, so an empty body would not pass for clean.
            expect(text).toContain(`inspections/${ID}/photos/p1.jpg`);
            expect(text).toContain('"method":"manual"');
        } finally { h.close(); }
    }, 120_000);

    it('control: a payload with the key in full does carry the id until the helper runs, so the check above can fail', () => {
        const built = projectReportForLink({ inspection: { id: ID, tenantId: TENANT_ID }, sections: [{ id: 's', items: [{ photos: [{ key: KEY }] }] }] } as unknown as ReportData);
        expect(carriers(built, TENANT_ID)).toEqual(['$.sections[0].items[0].photos[0].key']);
        expect(carriers(JSON.parse(relativizeSerialized(JSON.stringify(built), TENANT_ID)), TENANT_ID)).toEqual([]);
    });
});

describe('the photo URLs of the response resolve', () => {
    it.each(['client', 'agent', 'owner', 'render'] as const)('%s access: every photo URL in the body returns the bytes', async (mode) => {
        const { h, call } = await setup();
        try {
            const access = (await accessModes(h))[mode];
            const body = await (await call(access.report, access.headers)).json() as { data: Record<string, unknown> };
            const urls = JSON.stringify(body).match(/\/api\/public\/report\/[^"]*\/photo\?[^"]*/g) ?? [];
            expect(urls.length).toBeGreaterThan(2);
            for (const url of urls) {
                const res = await call(url, access.headers);
                expect(res.status, url).toBe(200);
                expect(new Uint8Array(await res.arrayBuffer()), url).toEqual(BYTES);
            }
            // The credential badge is among them, served through the same route.
            expect(urls.some((url) => url.includes(encodeURIComponent(`credentials/${INSPECTOR_ID}/logo-1.png`)))).toBe(true);
        } finally { h.close(); }
    }, 120_000);

    it('serves both the relative form and the full form older links carry', async () => {
        const { h, call } = await setup();
        try {
            const { client } = await accessModes(h);
            const base = `/api/public/report/${TENANT_SLUG}/${ID}/photo`;
            const relative = await call(`${base}?key=${encodeURIComponent(`inspections/${ID}/photos/p1.jpg`)}&${client.photo}`);
            const full = await call(`${base}?key=${encodeURIComponent(KEY)}&${client.photo}`);
            expect(relative.status).toBe(200);
            expect(full.status).toBe(200);
            expect(new Uint8Array(await relative.arrayBuffer())).toEqual(BYTES);
            expect(new Uint8Array(await full.arrayBuffer())).toEqual(BYTES);
        } finally { h.close(); }
    }, 120_000);

    it('keeps the ownership check strict', async () => {
        const { h, call } = await setup();
        try {
            const { client } = await accessModes(h);
            const base = `/api/public/report/${TENANT_SLUG}/${ID}/photo`;
            const status = async (key: string) => (await call(`${base}?key=${encodeURIComponent(key)}&${client.photo}`)).status;
            // Control: the same token and route serve the right key.
            expect(await status(`inspections/${ID}/photos/p1.jpg`)).toBe(200);
            expect(await status(`inspections/${OTHER_ID}/photos/p1.jpg`)).toBe(404);
            expect(await status(`${TENANT_ID}/inspections/${OTHER_ID}/photos/p1.jpg`)).toBe(404);
            expect(await status(`${OTHER_TENANT}/inspections/${ID}/photos/p1.jpg`)).toBe(404);
            expect(await status(`inspections/${ID}/../${OTHER_ID}/photos/p1.jpg`)).toBe(404);
            expect(await status(`${TENANT_ID}/inspections/${ID}/../../${OTHER_TENANT}/x.jpg`)).toBe(404);
            expect(await status(`inspections/${ID}//photos/p1.jpg`)).toBe(404);
            expect(await status(`${TENANT_ID}/inspections/${ID}//photos/p1.jpg`)).toBe(404);
            expect(await status(`inspections/${ID}/`)).toBe(404);
            expect(await status(`credentials/${INSPECTOR_ID}/logo-1.png`)).toBe(200);
            expect(await status(LOGO)).toBe(200);
            expect(await status(`credentials/${INSPECTOR_ID}/other.png`)).toBe(404);
            expect(await status(`credentials/${INSPECTOR_ID}/../${INSPECTOR_ID}/logo-1.png`)).toBe(404);
            expect(await status(`${OTHER_TENANT}/credentials/${INSPECTOR_ID}/logo-1.png`)).toBe(404);
            expect(await status('')).toBe(404);
            expect(await status('photos/p1.jpg')).toBe(404);
            expect(await status(`${TENANT_ID}/${TENANT_ID}/inspections/${ID}/photos/p1.jpg`)).toBe(404);
        } finally { h.close(); }
    }, 120_000);
});

describe('a credential badge through the report photo route', () => {
    const base = `/api/public/report/${TENANT_SLUG}/${ID}/photo`;
    const badge = (token: string, file: string, extra = '') => `${base}?key=${encodeURIComponent(`credentials/${INSPECTOR_ID}/${file}`)}&${token}${extra}`;

    it('serves an SVG with its vector content type, untouched even when a variant is asked for', async () => {
        const { h, call, widths } = await setup();
        try {
            const { client } = await accessModes(h);
            for (const extra of ['', '&v=reportCover']) {
                const res = await call(badge(client.photo, 'logo-2.svg', extra));
                expect(res.status).toBe(200);
                expect(res.headers.get('content-type')).toBe('image/svg+xml');
                expect(new Uint8Array(await res.arrayBuffer())).toEqual(SVG_BYTES);
            }
            expect(widths).toEqual([]);
        } finally { h.close(); }
    }, 120_000);

    it('serves a PNG as stored, and at the variant width as a webp when one is asked for', async () => {
        const { h, call, widths } = await setup();
        try {
            const { client } = await accessModes(h);
            const plain = await call(badge(client.photo, 'logo-1.png'));
            expect(plain.headers.get('content-type')).toBe('image/png');
            expect(new Uint8Array(await plain.arrayBuffer())).toEqual(BYTES);
            expect(widths).toEqual([]);
            const sized = await call(badge(client.photo, 'logo-1.png', '&v=reportCover'));
            expect(sized.status).toBe(200);
            expect(sized.headers.get('content-type')).toBe('image/webp');
            expect(sized.headers.get('cache-control')).toBe('private, max-age=300');
            expect(plain.headers.get('cache-control')).toBe('private, max-age=300');
            expect(new Uint8Array(await sized.arrayBuffer())).toEqual(THUMB);
            expect(widths).toEqual([80]);
        } finally { h.close(); }
    }, 120_000);

    it('keeps the public brand-asset route on its own public cache headers', async () => {
        const { h, call } = await setup();
        try {
            const url = `/api/public/brand-asset?key=${encodeURIComponent(LOGO)}`;
            expect((await call(url)).headers.get('cache-control')).toBe('public, max-age=3600');
            expect((await call(`${url}&v=reportCover`)).headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
        } finally { h.close(); }
    }, 120_000);

    it('is refused once the token is revoked or the release gate is closed, while the owner preview still gets it', async () => {
        const { h, call } = await setup();
        try {
            const modes = await accessModes(h);
            const url = (access: { photo: string }) => badge(access.photo, 'logo-1.png');
            // Control: the same request is served first.
            expect((await call(url(modes.client))).status).toBe(200);
            await h.db.update(schema.inspections).set({ paymentRequired: true, paymentStatus: 'unpaid' } as never);
            expect((await call(url(modes.client))).status).toBe(404);
            const ownerHeaders = { ...modes.owner.headers };
            expect((await call(`${base}?key=${encodeURIComponent(`credentials/${INSPECTOR_ID}/logo-1.png`)}`, ownerHeaders)).status).toBe(200);
            await h.db.update(schema.inspections).set({ paymentRequired: false } as never);
            expect((await call(url(modes.client))).status).toBe(200);
            await h.db.update(schema.inspectionAccessTokens).set({ revokedAt: new Date() });
            expect((await call(url(modes.client))).status).toBe(404);
        } finally { h.close(); }
    }, 120_000);

    it('serves the original for an unknown variant, as brand-asset does, and never an error', async () => {
        const { h, call, widths } = await setup();
        try {
            const { client } = await accessModes(h);
            for (const v of ['nonsense', '__proto__', '']) {
                const res = await call(badge(client.photo, 'logo-1.png', `&v=${v}`));
                expect(res.status, v).toBe(200);
                expect(new Uint8Array(await res.arrayBuffer()), v).toEqual(BYTES);
            }
            expect(widths).toEqual([]);
        } finally { h.close(); }
    }, 120_000);

    it('does not apply the badge handling to an inspection photo', async () => {
        const { h, call, widths } = await setup();
        try {
            const { client } = await accessModes(h);
            const res = await call(`${base}?key=${encodeURIComponent(REL_KEY)}&${client.photo}&v=reportCover`);
            expect(res.headers.get('cache-control')).toBe('private, max-age=300');
            expect(widths).toEqual([]);
        } finally { h.close(); }
    }, 120_000);
});

describe('the owner preview from a browser, which sends only the session cookie', () => {
    const COOKIE = '__Host-inspector_token';
    const sessionJwt = async (h: Harness, claims: { sub?: string; tenantId?: string; role?: string; exp?: number }) => {
        const keyring = await buildKeyring(h.env as unknown as Record<string, string | undefined>);
        const now = Math.floor(Date.now() / 1000);
        return signJwt({ sub: claims.sub ?? OWNER_ID, 'custom:tenantId': claims.tenantId ?? TENANT_ID, 'custom:userRole': claims.role ?? 'owner', iat: now, exp: claims.exp ?? now + 3600 }, keyring);
    };
    const photoUrls = async (call: (path: string, headers?: Record<string, string>) => Promise<Response>, h: Harness) => {
        const owner = (await accessModes(h)).owner;
        const body = await (await call(owner.report, owner.headers)).text();
        return body.match(/\/api\/public\/report\/[^"]*\/photo\?[^"]*/g) ?? [];
    };

    it('serves every photo, the cover and the badge URL of the body to the cookie alone', async () => {
        const { h, call } = await setup();
        try {
            const urls = await photoUrls(call, h);
            expect(urls.length).toBeGreaterThan(3);
            expect(urls.some((url) => url.includes(encodeURIComponent('credentials/')))).toBe(true);
            const cookie = { cookie: `${COOKIE}=${await sessionJwt(h, {})}` };
            for (const url of urls) {
                const res = await call(url, cookie);
                expect(res.status, url).toBe(200);
                expect(new Uint8Array(await res.arrayBuffer()), url).toEqual(BYTES);
                // Control: the same request with no credential at all is refused, so removing the cookie fallback (which makes the
                // request above identical to this one) fails the assertions above.
                expect((await call(url)).status, url).toBe(404);
            }
        } finally { h.close(); }
    }, 120_000);

    it('refuses an invalid cookie, an expired one, a user of another company and a signature of another key', async () => {
        const { h, call } = await setup();
        try {
            const url = (await photoUrls(call, h))[0] as string;
            const good = await sessionJwt(h, {});
            expect((await call(url, { cookie: `${COOKIE}=${good}` })).status).toBe(200);
            const now = Math.floor(Date.now() / 1000);
            const expired = await sessionJwt(h, { exp: now - 60 });
            const foreign = await sessionJwt(h, { tenantId: OTHER_TENANT });
            for (const value of ['not-a-token', `${good}x`, expired, foreign]) {
                expect((await call(url, { cookie: `${COOKIE}=${value}` })).status, value.slice(0, 12)).toBe(404);
            }
            expect((await call(url, { cookie: `other-cookie=${good}` })).status).toBe(404);
        } finally { h.close(); }
    }, 120_000);

    it('treats a staff role exactly as the data route does', async () => {
        const { h, call } = await setup();
        try {
            const url = (await photoUrls(call, h))[0] as string;
            const base = `/api/public/report/${TENANT_SLUG}/${ID}`;
            for (const role of ['inspector', 'owner']) {
                const jwt = await sessionJwt(h, { role, sub: role === 'owner' ? OWNER_ID : INSPECTOR_ID });
                const data = await call(base, { authorization: `Bearer ${jwt}` });
                const photo = await call(url, { cookie: `${COOKIE}=${jwt}` });
                expect(photo.status, role).toBe(data.status);
                expect(photo.status, role).toBe(200);
            }
        } finally { h.close(); }
    }, 120_000);
});
