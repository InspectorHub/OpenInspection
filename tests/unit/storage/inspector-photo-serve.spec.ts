import { describe, it, expect } from 'vitest';
import { r2Keys } from '../../../server/lib/r2-keys';

/**
 * The public route GET /photos/:tenantId/inspector-photos/:filename joins both
 * params into an R2 key. The router decodes `%2F`, so either param can carry a
 * slash (or `..`) and address an object outside `{tenant}/inspector-photos/`.
 * R2 keys are not normalised, so nothing is read through `..`, but any other
 * key that happens to contain `/inspector-photos/` was reachable anonymously.
 * The serve key is now built only from a plain tenant id and a plain
 * `<user id>.<jpg|jpeg|png|webp>` filename.
 */
describe('r2Keys.inspectorPhotoServe', () => {
    it('builds the key for a plain tenant id and filename (positive controls)', () => {
        expect(r2Keys.inspectorPhotoServe('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-1111.jpg'))
            .toBe('aaaaaaaa-0000-0000-0000-000000000001/inspector-photos/bbbbbbbb-1111.jpg');
        expect(r2Keys.inspectorPhotoServe('TEN', 'U_1.PNG')).toBe('TEN/inspector-photos/U_1.PNG');
        expect(r2Keys.inspectorPhotoServe('TEN', 'u.webp')).toBe('TEN/inspector-photos/u.webp');
        expect(r2Keys.inspectorPhotoServe('TEN', 'u.jpeg')).toBe('TEN/inspector-photos/u.jpeg');
    });

    it.each([
        ['tenant with a decoded slash', 'B/messages/m1', 'abc.png'],
        ['tenant with a dot-dot segment', '..', 'abc.png'],
        ['empty tenant', '', 'abc.png'],
        ['filename with a decoded slash', 'TEN', 'x/inspector-photos/../../B/messages/m1/a.png'],
        ['filename with a dot-dot segment', 'TEN', '../secret.png'],
        ['filename with a backslash', 'TEN', 'a\b.png'],
        ['filename with another extension', 'TEN', 'user.html'],
        ['filename with no extension', 'TEN', 'user'],
        ['filename with a double extension', 'TEN', 'user.png.exe'],
        ['empty filename', 'TEN', ''],
    ])('refuses %s', (_label, tenant, filename) => {
        expect(r2Keys.inspectorPhotoServe(tenant, filename)).toBeNull();
    });
});
