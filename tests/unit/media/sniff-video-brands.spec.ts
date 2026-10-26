/**
 * Real-world `ftyp` heads of phone and camera clips. A clip is accepted when its major OR any compatible brand
 * is in the mp4 family, and the box's own size field bounds which compatible brands count. A still-image HEIF/AVIF
 * major is never a video, whatever it lists as compatible.
 */
import { describe, it, expect } from 'vitest';
import { sniffVideoType, sniffPhotoType } from '../../../server/lib/media/sniff';

const ascii = (s: string): number[] => [...s].map((ch) => ch.charCodeAt(0));
const u32 = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
/** A complete ftyp box (size field = its real length), followed by a `moov`-ish tail. */
function box(major: string, compatible: string[], opts: { size?: number; minor?: number } = {}): Uint8Array {
    const body = [...ascii('ftyp'), ...ascii(major), ...u32(opts.minor ?? 0), ...compatible.flatMap(ascii)];
    return new Uint8Array([...u32(opts.size ?? body.length + 4), ...body, ...ascii('moov'), 0, 0, 0, 8]);
}

describe('sniffVideoType: real clip heads', () => {
    const cases: [string, string, string[], 'video/mp4' | 'video/quicktime'][] = [
        ['Android camera (isom/mp42)', 'isom', ['isom', 'iso2', 'mp41', 'mp42'], 'video/mp4'],
        ['Android camera (mp42 major)', 'mp42', ['isom', 'mp42'], 'video/mp4'],
        ['iPhone mov', 'qt  ', ['qt  '], 'video/quicktime'],
        ['iPhone mov with a mp4 compatible brand', 'qt  ', ['isom'], 'video/quicktime'],
        ['iPhone mp4 export (M4V)', 'M4V ', ['M4V ', 'M4A ', 'mp42', 'isom'], 'video/mp4'],
        ['Sony/Huawei MSNV major with isom compat', 'MSNV', ['MSNV', 'isom'], 'video/mp4'],
        ['MSNV with only a compatible mp4 brand', 'XXXX', ['MSNV', 'mp42'], 'video/mp4'],
        ['3GPP 3gp4', '3gp4', ['isom', '3gp4'], 'video/mp4'],
        ['3GPP 3gp5', '3gp5', ['3gp5'], 'video/mp4'],
        ['3GPP 3gp6', '3gp6', ['3gp6'], 'video/mp4'],
        ['3GPP2 3g2a', '3g2a', ['3g2a'], 'video/mp4'],
        ['iso3', 'iso3', ['iso3'], 'video/mp4'],
        ['iso5', 'iso5', ['iso5', 'iso6', 'mp41'], 'video/mp4'],
        ['iso9', 'iso9', ['iso9'], 'video/mp4'],
        ['f4v', 'f4v ', ['f4v ', 'isom'], 'video/mp4'],
        ['M4VH', 'M4VH', ['M4VH'], 'video/mp4'],
        ['M4VP', 'M4VP', ['M4VP'], 'video/mp4'],
        ['mp71', 'mp71', ['mp71'], 'video/mp4'],
        ['Sony XAVC', 'XAVC', ['XAVC', 'iso6'], 'video/mp4'],
        ['Avid NDAS', 'NDAS', ['NDAS'], 'video/mp4'],
        ['DASH segment', 'dash', ['dash', 'iso6'], 'video/mp4'],
    ];
    it.each(cases)('accepts %s', (_name, major, compat, type) => {
        expect(sniffVideoType(box(major, compat))).toBe(type);
    });

    it('refuses a still-image HEIF/AVIF major even when it lists an mp4 brand as compatible', () => {
        for (const major of ['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs', 'mif1', 'msf1', 'avif', 'avis']) {
            expect(sniffVideoType(box(major, ['mif1', 'isom', 'mp42'])), major).toBeNull();
        }
        // Control: the same compatible list under a video major is accepted.
        expect(sniffVideoType(box('isom', ['mif1', 'isom', 'mp42']))).toBe('video/mp4');
    });

    it('refuses an unknown brand family, text with ftyp at the wrong offset, and truncated heads', () => {
        expect(sniffVideoType(box('abcd', ['efgh']))).toBeNull();
        expect(sniffVideoType(new Uint8Array(ascii('hello ftypisom world, this is text')))).toBeNull();
        expect(sniffVideoType(new Uint8Array([...ascii('xxftyp'), ...ascii('isom'), 0, 0, 0, 0]))).toBeNull();
        const ok = box('isom', ['mp42']);
        for (const n of [0, 3, 8, 11]) expect(sniffVideoType(ok.subarray(0, n)), String(n)).toBeNull();
        expect(sniffVideoType(ok.subarray(0, 12))).toBe('video/mp4'); // control: a major brand alone is enough
    });

    it('never reads compatible brands past the box end', () => {
        // The box ends after the major brand and minor version (size 16); the "compatible" isom after it belongs to the next box.
        const past = new Uint8Array([...u32(16), ...ascii('ftyp'), ...ascii('abcd'), 0, 0, 0, 0, ...ascii('isom')]);
        expect(sniffVideoType(past)).toBeNull();
        // Control: the same bytes with a box size that covers the brand are accepted.
        expect(sniffVideoType(box('abcd', ['isom']))).toBe('video/mp4');
        // A size of 0, 1 or one larger than the window falls back to the bytes inside the window.
        for (const size of [0, 1, 4000]) expect(sniffVideoType(box('abcd', ['isom'], { size })), String(size)).toBe('video/mp4');
    });

    it('applies the same box bound to a photo (heif brand past the box end is not heic)', () => {
        const past = new Uint8Array([...u32(16), ...ascii('ftyp'), ...ascii('isom'), 0, 0, 0, 0, ...ascii('mif1')]);
        expect(sniffPhotoType(past)).toBeNull();
        expect(sniffPhotoType(box('isom', ['mif1']))).toBe('image/heic');
    });
});
