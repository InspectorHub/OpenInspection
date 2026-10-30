import { afterEach, describe, expect, it } from 'vitest';
import { m, setFieldLocale } from '../i18n';
import type { MediaFileResult } from '../media-types';
import { offlinePhotoRejectionMessages, onlinePhotoRejectionMessages } from './photo-rejection-messages';

const ok = (index: number): MediaFileResult => ({ index, ok: true, key: `k${index}` });
const fail = (index: number, error: string, kept?: true): MediaFileResult => ({ index, ok: false, error, ...(kept ? { kept } : {}) });

afterEach(() => setFieldLocale('en'));

describe('online photo rejection messages', () => {
    it('CONTROL - a clean batch has nothing to say here', () => {
        expect(onlinePhotoRejectionMessages([ok(0), ok(1)])).toEqual([]);
    });

    it('tells the user both facts when some photos uploaded and one was too large', () => {
        const results = [...Array.from({ length: 9 }, (_, i) => ok(i)), fail(9, 'TOO_LARGE')];
        expect(onlinePhotoRejectionMessages(results)).toEqual([
            m.editor_route_photos_partial_upload({ success: 9, total: 10, failed: 1 }),
            m.editor_route_photo_too_large_single(),
        ]);
    });

    it('explains a batch where every photo was too large, without a zero-of-n summary', () => {
        const messages = onlinePhotoRejectionMessages([fail(0, 'TOO_LARGE'), fail(1, 'TOO_LARGE'), fail(2, 'TOO_LARGE')]);
        expect(messages).toEqual([m.editor_route_photo_too_large({ count: 3, s: 's' })]);
    });

    it('maps UNSUPPORTED_TYPE to its fixed reason, as the offline path does', () => {
        expect(onlinePhotoRejectionMessages([fail(0, 'UNSUPPORTED_TYPE')])).toEqual([m.editor_route_photo_unsupported_type({ count: 1, s: '' })]);
    });

    it('summarises an unknown failure next to the uploaded count, and never shows host text', () => {
        const messages = onlinePhotoRejectionMessages([ok(0), ok(1), fail(2, 'private path /srv/x')]);
        expect(messages).toEqual([m.editor_route_photos_partial_upload({ success: 2, total: 3, failed: 1 })]);
        expect(messages.join(' ')).not.toContain('private path');
    });

    it('CONTROL - only unknown failures keep the existing zero-of-n summary', () => {
        expect(onlinePhotoRejectionMessages([fail(0, 'HTTP_500'), fail(1, 'EXCEPTION')])).toEqual([
            m.editor_route_photos_partial_upload({ success: 0, total: 2, failed: 2 }),
        ]);
    });

    it('mixes a known reason with an unknown one: the reason once, the unknown counted', () => {
        expect(onlinePhotoRejectionMessages([fail(0, 'TOO_LARGE'), fail(1, 'HTTP_500')])).toEqual([
            m.editor_route_photo_too_large_single(),
            m.editor_route_photos_rejected({ count: 1, s: '' }),
        ]);
    });

    it('leaves photos the host kept on the device out of every count', () => {
        expect(onlinePhotoRejectionMessages([ok(0), fail(1, 'HTTP_500', true), fail(2, 'TOO_LARGE')])).toEqual([
            m.editor_route_photos_partial_upload({ success: 1, total: 2, failed: 1 }),
            m.editor_route_photo_too_large_single(),
        ]);
        expect(onlinePhotoRejectionMessages([ok(0), fail(1, 'HTTP_500', true)])).toEqual([]);
    });
});

describe('offline photo rejection messages', () => {
    it('CONTROL - nothing rejected means nothing to say', () => {
        expect(offlinePhotoRejectionMessages({ rejected: 0, reasons: {} }, 4)).toEqual([]);
    });

    it('tells the user both facts when 9 of 10 were stored and one was too large', () => {
        expect(offlinePhotoRejectionMessages({ rejected: 1, reasons: { tooLarge: 1 } }, 10)).toEqual([
            m.editor_route_photos_partial_added({ success: 9, total: 10, failed: 1 }),
            m.editor_route_photo_too_large_single(),
        ]);
    });

    it('explains a batch where every photo was too large, without a zero-of-n summary', () => {
        expect(offlinePhotoRejectionMessages({ rejected: 3, reasons: { tooLarge: 3 } }, 3)).toEqual([
            m.editor_route_photo_too_large({ count: 3, s: 's' }),
        ]);
    });

    it('lists unsupported types before oversized photos', () => {
        expect(offlinePhotoRejectionMessages({ rejected: 2, reasons: { tooLarge: 1, unsupportedType: 1 } }, 2)).toEqual([
            m.editor_route_photo_unsupported_type({ count: 1, s: '' }),
            m.editor_route_photo_too_large_single(),
        ]);
    });

    it('counts unknown failures next to the stored photos', () => {
        expect(offlinePhotoRejectionMessages({ rejected: 1, reasons: {} }, 3)).toEqual([
            m.editor_route_photos_partial_added({ success: 2, total: 3, failed: 1 }),
        ]);
    });

    it('CONTROL - only unknown failures keep the generic count', () => {
        expect(offlinePhotoRejectionMessages({ rejected: 2, reasons: {} }, 2)).toEqual([m.editor_route_photos_rejected({ count: 2, s: 's' })]);
    });
});

describe('rejection copy reads correctly for one and for several photos', () => {
    const render = (count: number) => {
        const args = { count, s: count === 1 ? '' : 's' };
        return {
            unsupported: m.editor_route_photo_unsupported_type(args),
            tooLarge: count === 1 ? m.editor_route_photo_too_large_single() : m.editor_route_photo_too_large(args),
        };
    };

    it('English: the noun agrees with the count', () => {
        setFieldLocale('en');
        expect(render(1).unsupported).toBe('1 photo could not be added because the file type is not supported.');
        expect(render(3).unsupported).toBe('3 photos could not be added because the file type is not supported.');
        expect(render(3).tooLarge).toBe('3 photos could not be added: larger than the maximum photo size.');
        expect(render(1).tooLarge).toBe('This photo is larger than the maximum photo size and cannot be added.');
    });

    it('Spanish: the verb is not tied to the count, so it never disagrees with it', () => {
        setFieldLocale('es-419');
        expect(render(1).unsupported).toBe('No se pudo agregar: 1 foto. El tipo de archivo no es compatible.');
        expect(render(3).unsupported).toBe('No se pudo agregar: 3 fotos. El tipo de archivo no es compatible.');
        expect(render(3).tooLarge).toBe('No se pudo agregar: 3 fotos. El tamaño supera el máximo permitido.');
        // The singular verb must not sit directly in front of a plural count.
        expect(render(3).unsupported).not.toMatch(/No se pudo agregar \d/);
        expect(render(3).tooLarge).not.toMatch(/No se pudo agregar \d/);
    });

    it('names no host limit or format list in either language', () => {
        for (const locale of ['en', 'es-419']) {
            setFieldLocale(locale);
            const all = [render(1), render(3)].flatMap((r) => [r.unsupported, r.tooLarge]).join(' ');
            expect(all).not.toMatch(/\d+\s*MB|JPEG|PNG|HEIC/);
            expect(all).toMatch(/\d/); // CONTROL: the probe does see the counts it rendered
        }
    });
});

describe('partial upload summary agrees with the count', () => {
    it('English reads the same for 1 of 3', () => {
        setFieldLocale('en');
        expect(m.editor_route_photos_partial_upload({ success: 1, total: 3, failed: 2 })).toBe('1 of 3 photos uploaded — 2 failed.');
    });

    it('Spanish uses wording that does not tie a plural verb to the failed count', () => {
        setFieldLocale('es-419');
        expect(m.editor_route_photos_partial_upload({ success: 1, total: 3, failed: 2 })).toBe('Se subieron 1 de 3 fotos; con error: 2.');
        expect(m.editor_route_photos_partial_upload({ success: 2, total: 3, failed: 1 })).toBe('Se subieron 2 de 3 fotos; con error: 1.');
        expect(m.editor_route_photos_partial_upload({ success: 2, total: 3, failed: 1 })).not.toContain('fallaron');
    });
});
