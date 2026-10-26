/**
 * Magic-number sniffing for uploaded photos, posters and videos. The declared Content-Type is client
 * controlled, so these functions decide from the first bytes only. Each refusal has a positive control.
 */
import { describe, it, expect } from 'vitest';
import { sniffPhotoType, sniffPosterType, sniffVideoType, headBytes } from '../../../server/lib/media/sniff';

const ascii = (s: string) => [...s].map((ch) => ch.charCodeAt(0));
/** An ISO base media file: a 4-byte size, `ftyp`, the major brand, a minor version and compatible brands. */
const ftyp = (major: string, ...compatible: string[]) =>
    new Uint8Array([0, 0, 0, 24, ...ascii('ftyp'), ...ascii(major), 0, 0, 0, 0, ...compatible.flatMap(ascii)]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const WEBP = new Uint8Array([...ascii('RIFF'), 1, 2, 3, 4, ...ascii('WEBP'), 0]);
const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42]);

describe('sniffPhotoType', () => {
    it('recognises jpeg, png and the heic family', () => {
        expect(sniffPhotoType(JPEG)).toBe('image/jpeg');
        expect(sniffPhotoType(PNG)).toBe('image/png');
        expect(sniffPhotoType(ftyp('heic'))).toBe('image/heic');
        expect(sniffPhotoType(ftyp('heix'))).toBe('image/heic');
        expect(sniffPhotoType(ftyp('mif1'))).toBe('image/heic');
    });
    it('accepts a heic file whose only heif brand is a compatible one', () => {
        expect(sniffPhotoType(ftyp('isom', 'mif1'))).toBe('image/heic');
    });
    it('refuses avif even though it lists mif1 as compatible', () => {
        expect(sniffPhotoType(ftyp('avif', 'mif1', 'miaf'))).toBeNull();
        expect(sniffPhotoType(ftyp('avis', 'mif1'))).toBeNull();
    });
    it('refuses svg, html, zip, exe, pdf, webp and a video', () => {
        for (const head of ['<svg xmlns=', '<!DOCTYPE html>', '<html><body>', '<?xml version', 'PK\u0003\u0004rest', 'MZ\u0090\u0000rest', '%PDF-1.7 xx']) {
            expect(sniffPhotoType(new Uint8Array(ascii(head)))).toBeNull();
        }
        expect(sniffPhotoType(WEBP)).toBeNull();
        expect(sniffPhotoType(ftyp('isom', 'mp42'))).toBeNull();
    });
    it('answers null for empty and truncated bodies instead of throwing', () => {
        expect(sniffPhotoType(new Uint8Array(0))).toBeNull();
        expect(sniffPhotoType(JPEG.subarray(0, 2))).toBeNull();
        expect(sniffPhotoType(PNG.subarray(0, 7))).toBeNull();
        expect(sniffPhotoType(ftyp('heic').subarray(0, 11))).toBeNull();
    });
});

describe('sniffPosterType', () => {
    it('takes jpeg, png and webp, and nothing else', () => {
        expect(sniffPosterType(JPEG)).toBe('image/jpeg');
        expect(sniffPosterType(PNG)).toBe('image/png');
        expect(sniffPosterType(WEBP)).toBe('image/webp');
        expect(sniffPosterType(ftyp('heic'))).toBeNull();
        expect(sniffPosterType(new Uint8Array(ascii('<svg xmlns=')))).toBeNull();
    });
});

describe('sniffVideoType', () => {
    it('recognises mp4, quicktime and webm', () => {
        expect(sniffVideoType(ftyp('isom', 'mp42'))).toBe('video/mp4');
        expect(sniffVideoType(ftyp('mp42'))).toBe('video/mp4');
        expect(sniffVideoType(ftyp('M4V '))).toBe('video/mp4');
        expect(sniffVideoType(ftyp('qt  '))).toBe('video/quicktime');
        expect(sniffVideoType(WEBM)).toBe('video/webm');
    });
    it('refuses images, html and a heic file', () => {
        expect(sniffVideoType(JPEG)).toBeNull();
        expect(sniffVideoType(PNG)).toBeNull();
        expect(sniffVideoType(new Uint8Array(ascii('<html><body>')))).toBeNull();
        expect(sniffVideoType(ftyp('heic'))).toBeNull();
        expect(sniffVideoType(ftyp('avif'))).toBeNull();
    });
    it('answers null for empty and truncated bodies', () => {
        expect(sniffVideoType(new Uint8Array(0))).toBeNull();
        expect(sniffVideoType(WEBM.subarray(0, 3))).toBeNull();
        expect(sniffVideoType(ftyp('mp42').subarray(0, 8))).toBeNull();
    });
});

describe('headBytes', () => {
    it('reads at most 64 bytes of a blob', async () => {
        const head = await headBytes(new Blob([new Uint8Array(500).fill(7)]));
        expect(head.length).toBe(64);
        expect((await headBytes(new Blob([]))).length).toBe(0);
    });
});
