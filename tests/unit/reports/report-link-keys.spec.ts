/**
 * The key rewrite of a report link response, and the helpers around it.
 *
 * The rewrite works on the serialized body. The tree walk it replaced is kept here, as a reference, so the two can be compared on a
 * payload with every carrier of a key and with strings that must not change.
 */
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { credentialImageUrl, projectCredentialBadgeUrls, relativizeSerialized, resolveReportPhotoKey, respondRelativizedJson } from '../../../server/lib/report-link-keys';

const T = '11111111-0000-4000-8000-000000000001';
const OTHER = '11111111-0000-4000-8000-0000000000ff';
const I = '44444444-0000-4000-8000-000000000001';
const KEY = `${T}/inspections/${I}/photos/p1.jpg`;
const REL = `inspections/${I}/photos/p1.jpg`;
const BADGE = `${T}/credentials/u1/logo-1.png`;

// ---- The tree walk that shipped before the serialized rewrite, kept as the reference ------------------------------------------------
const REF_FOLDERS = ['inspections', 'credentials'];
function refString(value: string, tenantId: string): string {
    const own = `${tenantId}/`;
    if (value.startsWith(own)) return REF_FOLDERS.some((folder) => value.startsWith(`${own}${folder}/`)) ? value.slice(own.length) : value;
    if (!value.includes('key=') || value.includes('/api/public/brand-asset')) return value;
    return value.replace(/([?&]key=)([^&#]*)/g, (whole, name: string, raw: string) => {
        let key: string;
        try { key = decodeURIComponent(raw); } catch { return whole; }
        if (!REF_FOLDERS.some((folder) => key.startsWith(`${tenantId}/${folder}/`))) return whole;
        return `${name}${encodeURIComponent(key.slice(own.length))}`;
    });
}
function refTree(value: unknown, tenantId: string): unknown {
    if (typeof value === 'string') return refString(value, tenantId);
    if (Array.isArray(value)) return value.map((element) => refTree(element, tenantId));
    if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, refTree(child, tenantId)]));
    return value;
}

const photoUrl = (key: string, extra = '&token=abc') => `/api/public/report/acme/${I}/photo?key=${encodeURIComponent(key)}${extra}`;
const photo = (n: number) => ({ key: `${T}/inspections/${I}/photos/p${n}.jpg`, originalKey: `${T}/inspections/${I}/photos/o${n}.jpg`, url: photoUrl(`${T}/inspections/${I}/photos/p${n}.jpg`), photoNo: n });

/** A smaller payload with every carrier of a key, and the strings that must not change. */
function payload(): Record<string, unknown> {
    const item = (n: number) => ({
        id: `i${n}`, label: 'Roof cover', rating: 'satisfactory', notes: `${T}/branding/logo-x.png is not a key into a report folder`,
        photos: [photo(1), { ...photo(2), media: { kind: 'image', src: photoUrl(`${T}/inspections/${I}/photos/p2.jpg`), key: `${T}/inspections/${I}/photos/p2.jpg` } }],
        original: { rating: 'poor', notes: 'earlier', photos: [photo(3)] },
        resolvedTabs: { information: [{ id: 'ri1', comment: 'Plain text mentioning inspections/ and credentials/ folders.' }], limitations: [], defects: [] },
    });
    return {
        success: true,
        data: {
            inspection: { id: I, propertyAddress: `${OTHER}/inspections/${I}/not-ours` },
            coverPhotoUrl: photoUrl(`${T}/inspections/${I}/photos/cover.jpg`),
            sections: [{ id: 's1', items: [item(1), item(2)] }, { id: 's2', items: [item(3)] }],
            photoAppendix: [{ photoNo: 1, key: KEY, url: photoUrl(KEY), caption: null }],
            inspectorCredentials: [{ label: 'CPI', imageUrl: photoUrl(BADGE, '&token=abc&v=reportCover') }],
            foreign: { url: photoUrl(`${OTHER}/inspections/${I}/photos/p1.jpg`), key: `${OTHER}/inspections/${I}/photos/p1.jpg`, brand: `https://app.example.test/api/public/brand-asset?key=${encodeURIComponent(`${OTHER}/credentials/u1/logo-1.png`)}` },
            note: `This note starts the sentence with the company id alone: ${T} and nothing after it.`,
            id: T,
        },
        courtesyTranslation: null,
    };
}

describe('relativizeSerialized', () => {
    it('gives byte-identical output to the tree walk on a payload with every carrier of a key and the strings that must not change', () => {
        const body = payload();
        const viaTree = JSON.stringify(refTree(body, T));
        const viaText = relativizeSerialized(JSON.stringify(body), T);
        expect(viaText).toBe(viaTree);
        // Control: the payload did carry the company id in the places the rewrite exists for, and kept it where it must stay.
        const original = JSON.stringify(body);
        expect(original.split(T).length - 1).toBeGreaterThan(15);
        expect(viaText).not.toContain(`${T}/inspections/`);
        expect(viaText).not.toContain(`${T}%2Finspections%2F`);
        expect(viaText).not.toContain(`${T}%2Fcredentials%2F`);
        expect(viaText).toContain(`${T}/branding/logo-x.png`);
        expect(viaText).toContain(`${OTHER}/inspections/`);
        expect(viaText).toContain(encodeURIComponent(`${OTHER}/credentials/u1/logo-1.png`));
        expect(viaText).toContain(`company id alone: ${T} and nothing after it`);
        expect(viaText).toContain('v=reportCover');
    });

    it('rewrites the literal and the percent-encoded form of both folders, and leaves everything else', () => {
        expect(relativizeSerialized(`"${T}/inspections/x" "${T}/credentials/y"`, T)).toBe('"inspections/x" "credentials/y"');
        expect(relativizeSerialized(`key=${T}%2Finspections%2Fx&k=${T}%2Fcredentials%2Fy`, T)).toBe('key=inspections%2Fx&k=credentials%2Fy');
        for (const kept of [`${T}`, `${T}/branding/logo-1.png`, `${T}/messages/m/a.png`, `${OTHER}/inspections/x`, 'inspections/x', `${T}x/inspections/x`]) {
            expect(relativizeSerialized(kept, T), kept).toBe(kept);
        }
    });

    it('leaves an id that is only the tail of a longer identifier, and accepts a lowercase percent-encoded separator', () => {
        for (const kept of [`a${T}/inspections/x`, `-${T}/credentials/x`, `_${T}%2Finspections%2Fx`, `9${T}/inspections/x`]) {
            expect(relativizeSerialized(kept, T), kept).toBe(kept);
        }
        // The carriers have a quote, `=`, `/` or a space on their left and are still rewritten.
        expect(relativizeSerialized(`"${T}/inspections/x" key=${T}%2Finspections%2Fx /${T}/credentials/y ${T}/inspections/z`, T)).toBe('"inspections/x" key=inspections%2Fx /credentials/y inspections/z');
        expect(relativizeSerialized(`key=${T}%2finspections%2fx&k=${T}%2Fcredentials%2fy`, T)).toBe('key=inspections%2fx&k=credentials%2fy');
    });

    it('does not read the id as a pattern', () => {
        expect(relativizeSerialized('a.b/inspections/x axb/inspections/x', 'a.b')).toBe('inspections/x axb/inspections/x');
        expect(relativizeSerialized('(t)/credentials/x', '(t)')).toBe('credentials/x');
    });

    it('documents the one deliberate difference from the tree walk: the sequence inside free text is rewritten too', () => {
        const note = JSON.stringify({ note: `see ${T}/inspections/${I}/x for the file` });
        expect(refTree(JSON.parse(note), T)).toEqual(JSON.parse(note));
        expect(relativizeSerialized(note, T)).toBe(JSON.stringify({ note: `see inspections/${I}/x for the file` }));
    });

    it('serves the badge URL the service builds (relative brand-asset) through the photo route first; an absolute own-company one is never built', () => {
        const brand = `/api/public/brand-asset?key=${encodeURIComponent(BADGE)}`;
        const routed = projectCredentialBadgeUrls({ inspectorCredentials: [{ label: 'CPI', imageUrl: brand }] }, T, (key) => photoUrl(key));
        expect(JSON.stringify(routed)).toContain('/api/public/report/');
        expect(relativizeSerialized(JSON.stringify(routed), T)).not.toContain(T);
        // The tree walk kept an absolute brand-asset URL whole and the text rewrite does not; the service only ever builds the relative form.
        const absolute = JSON.stringify({ imageUrl: `https://app.example.test${brand}` });
        expect(JSON.stringify(refTree(JSON.parse(absolute), T))).toBe(absolute);
        expect(relativizeSerialized(absolute, T)).not.toBe(absolute);
    });
});

describe('respondRelativizedJson', () => {
    it('answers like c.json (status, content type, key order) with the rewritten text', async () => {
        const body = payload();
        const app = new Hono();
        app.get('/relativized', (c) => respondRelativizedJson(c, body, T));
        app.get('/plain', (c) => c.json(body, 200));
        const a = await app.request('/relativized');
        const b = await app.request('/plain');
        expect(a.status).toBe(b.status);
        expect(a.headers.get('content-type')).toBe(b.headers.get('content-type'));
        const text = await a.text();
        expect(text).toBe(relativizeSerialized(JSON.stringify(body), T));
        expect(Object.keys(JSON.parse(text) as object)).toEqual(Object.keys(body));
        expect(JSON.parse(text)).toEqual(refTree(JSON.parse(JSON.stringify(body)), T));
    });
});

describe('resolveReportPhotoKey', () => {
    it('resolves the relative form and the full form to the full key', () => {
        expect(resolveReportPhotoKey(REL, T, I)).toBe(KEY);
        expect(resolveReportPhotoKey(KEY, T, I)).toBe(KEY);
        expect(resolveReportPhotoKey(`credentials/u1/logo-1.png`, T, I)).toBe(`${T}/credentials/u1/logo-1.png`);
    });

    it('refuses anything that is not under this company and this inspection', () => {
        const refused = [
            '', '/', `inspections/${I}/`, `inspections/other/p.jpg`, `${T}/inspections/other/p.jpg`, `other/inspections/${I}/p.jpg`,
            `${T}/${T}/inspections/${I}/p.jpg`, `inspections/${I}/../p.jpg`, `inspections/${I}/./p.jpg`, `inspections/${I}//p.jpg`,
            `${T}/inspections/${I}//p.jpg`, `${T}/inspections/${I}/../../x/y.jpg`, 'credentials/u1/other.png', 'credentials/../logo-1.png',
            `credentials/u1/../u2/logo-1.png`, 'photos/p.jpg',
        ];
        for (const key of refused) expect(resolveReportPhotoKey(key, T, I), JSON.stringify(key)).toBeNull();
    });
});

describe('credentialImageUrl', () => {
    const photoUrl = (key: string) => `/photo?key=${encodeURIComponent(key)}`;

    it('moves a badge of this company to the photo route and leaves everything else alone', () => {
        const badge = `${T}/credentials/u1/logo-1.png`;
        expect(credentialImageUrl(`/api/public/brand-asset?key=${encodeURIComponent(badge)}`, T, photoUrl)).toBe(photoUrl(badge));
        const foreign = `/api/public/brand-asset?key=${encodeURIComponent('other/credentials/u1/logo-1.png')}`;
        expect(credentialImageUrl(foreign, T, photoUrl)).toBe(foreign);
        expect(credentialImageUrl(null, T, photoUrl)).toBeNull();
        expect(credentialImageUrl('/elsewhere?key=x', T, photoUrl)).toBe('/elsewhere?key=x');
    });
});

describe('projectCredentialBadgeUrls', () => {
    it('serves a badge through the photo route, copies nothing else, and leaves a payload without credentials as it is', () => {
        const photoRoute = (key: string) => `/photo?key=${encodeURIComponent(key)}&token=abc`;
        const input = { inspectorCredentials: [{ label: 'CPI', imageUrl: `/api/public/brand-asset?key=${encodeURIComponent(BADGE)}` }, { label: 'text only', imageUrl: null }], cover: KEY };
        const out = projectCredentialBadgeUrls(input, T, photoRoute);
        expect(out.inspectorCredentials[0]?.imageUrl).toBe(photoRoute(BADGE));
        expect(out.inspectorCredentials[1]?.imageUrl).toBeNull();
        expect(out.cover).toBe(KEY);
        expect(input.inspectorCredentials[0]?.imageUrl).toContain(encodeURIComponent(T));
        const bare = { cover: KEY };
        expect(projectCredentialBadgeUrls(bare, T, photoRoute)).toBe(bare);
    });
});
