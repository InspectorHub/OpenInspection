/**
 * relativizeReportKeys, resolveReportPhotoKey and credentialImageUrl, on their own.
 *
 * The rewrite touches only a string that starts with the company folder, and the `key=` of a URL that names an object in one of
 * the company's report folders; everything else must come back as it went in, and the input must never change.
 */
import { describe, it, expect } from 'vitest';
import { credentialImageUrl, finishReportLink, relativizeReportKeys, resolveReportPhotoKey } from '../../../server/lib/report-link-keys';

const T = '11111111-0000-4000-8000-000000000001';
const I = '44444444-0000-4000-8000-000000000001';
const KEY = `${T}/inspections/${I}/photos/p1.jpg`;
const REL = `inspections/${I}/photos/p1.jpg`;

describe('relativizeReportKeys', () => {
    it('rewrites keys in nested objects and arrays, and the key of a photo URL', () => {
        const input = {
            sections: [{ items: [{ photos: [{ key: KEY, originalKey: KEY, url: `/api/public/report/acme/${I}/photo?key=${encodeURIComponent(KEY)}&token=abc` }] }] }],
            cover: `/api/public/report/acme/${I}/photo?token=abc&key=${encodeURIComponent(KEY)}&w=200`,
        };
        const out = relativizeReportKeys(input, T);
        expect(out.sections[0]?.items[0]?.photos[0]).toEqual({
            key: REL, originalKey: REL, url: `/api/public/report/acme/${I}/photo?key=${encodeURIComponent(REL)}&token=abc`,
        });
        expect(out.cover).toBe(`/api/public/report/acme/${I}/photo?token=abc&key=${encodeURIComponent(REL)}&w=200`);
    });

    it('handles a key whose slashes are encoded as %2F and rewrites a credential badge key', () => {
        const badge = `${T}/credentials/u1/logo-1.png`;
        expect(relativizeReportKeys(`/x?key=${encodeURIComponent(KEY)}`, T)).toBe(`/x?key=${encodeURIComponent(REL)}`);
        expect(relativizeReportKeys(`/x?key=${encodeURIComponent(badge)}`, T)).toBe(`/x?key=${encodeURIComponent('credentials/u1/logo-1.png')}`);
    });

    it('leaves every other string, number, null and date as it was', () => {
        const other = '11111111-0000-4000-8000-0000000000ff';
        const date = new Date(0);
        const input = {
            note: `see ${T} for details`, plain: 'photos/p1.jpg', name: 'inspections/x',
            foreign: `${other}/inspections/${I}/p.jpg`,
            foreignUrl: `/x?key=${encodeURIComponent(`${other}/inspections/${I}/p.jpg`)}`,
            otherFolder: `/x?key=${encodeURIComponent(`${T}/branding/logo-1.png`)}`,
            noKey: '/x?token=abc', brokenEscape: '/x?key=%E0%A4%A', n: 3, nothing: null, flag: false, date,
        };
        expect(relativizeReportKeys(input, T)).toEqual(input);
        expect(relativizeReportKeys(input, T).date).toBe(date);
    });

    it('leaves strings that only begin with the company id, and the variant parameter, alone', () => {
        expect(relativizeReportKeys(`${T}/branding/logo-x.png`, T)).toBe(`${T}/branding/logo-x.png`);
        expect(relativizeReportKeys(`${T}/ is the folder of this company`, T)).toBe(`${T}/ is the folder of this company`);
        expect(relativizeReportKeys(`${T}/inspections/${I}/p.jpg`, T)).toBe(`inspections/${I}/p.jpg`);
        const badge = `/api/public/report/acme/${I}/photo?key=${encodeURIComponent(`${T}/credentials/u1/logo-1.png`)}&token=abc&v=reportCover`;
        expect(relativizeReportKeys(badge, T)).toBe(`/api/public/report/acme/${I}/photo?key=${encodeURIComponent('credentials/u1/logo-1.png')}&token=abc&v=reportCover`);
    });

    it('leaves an absolute brand-asset URL whole, because that route cannot resolve a company', () => {
        const absolute = `https://app.example.test/api/public/brand-asset?key=${encodeURIComponent(`${T}/credentials/u1/logo-1.png`)}`;
        expect(relativizeReportKeys(absolute, T)).toBe(absolute);
    });

    it('walks objects without a prototype, a __proto__ key and very deep nesting', () => {
        const bare = Object.create(null) as Record<string, unknown>;
        bare.key = KEY;
        const out = relativizeReportKeys({ bare }, T);
        expect(out.bare.key).toBe(REL);
        const parsed = JSON.parse(`{"__proto__": {"key": "${KEY}"}, "other": "${KEY}"}`) as Record<string, unknown>;
        const walked = relativizeReportKeys(parsed, T);
        expect(Object.keys(walked).sort()).toEqual(['__proto__', 'other']);
        expect(Object.getPrototypeOf(walked)).toBe(Object.prototype);
        expect(walked.other).toBe(REL);
        expect(Object.getOwnPropertyDescriptor(walked, '__proto__')?.value).toEqual({ key: REL });
        let deep: unknown = KEY;
        for (let level = 0; level < 200; level += 1) deep = { next: deep };
        let cursor: unknown = relativizeReportKeys(deep, T);
        for (let level = 0; level < 200; level += 1) cursor = (cursor as { next: unknown }).next;
        expect(cursor).toBe(REL);
    });

    it('builds a new value and leaves the input untouched', () => {
        const input = { photos: [{ key: KEY }] };
        const frozen = JSON.stringify(input);
        const out = relativizeReportKeys(input, T);
        expect(JSON.stringify(input)).toBe(frozen);
        expect(out).not.toBe(input);
        expect(out.photos).not.toBe(input.photos);
        expect(out.photos[0]).toEqual({ key: REL });
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

describe('finishReportLink', () => {
    it('serves a badge through the photo route, states keys relative, and leaves a payload without credentials without them', () => {
        const badge = `${T}/credentials/u1/logo-1.png`;
        const photoUrl = (key: string) => `/photo?key=${encodeURIComponent(key)}&token=abc`;
        const input = { inspectorCredentials: [{ label: 'CPI', imageUrl: `/api/public/brand-asset?key=${encodeURIComponent(badge)}` }, { label: 'text only', imageUrl: null }], cover: KEY };
        const out = finishReportLink(input, T, photoUrl);
        expect(out.inspectorCredentials[0]?.imageUrl).toBe(`/photo?key=${encodeURIComponent('credentials/u1/logo-1.png')}&token=abc`);
        expect(out.inspectorCredentials[1]?.imageUrl).toBeNull();
        expect(out.cover).toBe(REL);
        expect(input.inspectorCredentials[0]?.imageUrl).toContain(encodeURIComponent(T));
        expect(finishReportLink({ cover: KEY }, T, photoUrl)).toEqual({ cover: REL });
    });
});
