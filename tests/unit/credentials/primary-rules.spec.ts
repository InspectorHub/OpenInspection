/**
 * Which single credential answers a surface with room for exactly one.
 *
 * Both rules read the same list in the same direction, and that is the design:
 * the inspector orders their credentials ONCE, and that single act decides both
 * the licence line and the badge beside the signature. A separate "primary"
 * flag would be a second source of truth to drift out of step with the list.
 */
import { describe, it, expect } from 'vitest';
import { primaryLicenseOf, primaryBadgeOf } from '../../../server/lib/credentials/primary';

const cred = (memberNumber: string | null, imageUrl: string | null = null) => ({ memberNumber, imageUrl });

describe('primaryLicenseOf', () => {
    it('takes the first entry carrying a member number', () => {
        expect(primaryLicenseOf([cred(null), cred('TX-9001'), cred('N-2')])).toBe('TX-9001');
    });

    it('ignores whitespace-only numbers rather than printing a blank licence', () => {
        expect(primaryLicenseOf([cred('   '), cred('TX-9001')])).toBe('TX-9001');
    });

    it('trims what it returns', () => {
        expect(primaryLicenseOf([cred('  TX-9001 ')])).toBe('TX-9001');
    });

    it('is null when there is none', () => {
        expect(primaryLicenseOf([])).toBeNull();
        expect(primaryLicenseOf([cred(null), cred('')])).toBeNull();
    });
});

describe('primaryBadgeOf', () => {
    it('takes the first entry carrying an image', () => {
        expect(primaryBadgeOf([cred(null), cred(null, '/a.png'), cred(null, '/b.png')])).toBe('/a.png');
    });

    it('skips text-only credentials sitting ahead of the badges', () => {
        // The backfilled state licence sorts at -1 and has no image, so this is
        // the ordinary case rather than an edge one.
        expect(primaryBadgeOf([cred('TX-9001'), cred(null, '/assoc.png')])).toBe('/assoc.png');
    });

    it('is null when the inspector has no badge at all', () => {
        expect(primaryBadgeOf([])).toBeNull();
        expect(primaryBadgeOf([cred('TX-9001'), cred('N-2')])).toBeNull();
    });
});

describe('reordering is how the choice is made', () => {
    it('changes both answers by changing nothing but the order', () => {
        const nachi = cred('N-1', '/nachi.png');
        const ashi = cred('A-2', '/ashi.png');

        expect(primaryLicenseOf([nachi, ashi])).toBe('N-1');
        expect(primaryBadgeOf([nachi, ashi])).toBe('/nachi.png');

        // Move ASHI up in Licenses & affiliations and the report follows. This
        // is the whole contract of the reorder control: there is no other
        // switch, and no state that could disagree with the list.
        expect(primaryLicenseOf([ashi, nachi])).toBe('A-2');
        expect(primaryBadgeOf([ashi, nachi])).toBe('/ashi.png');
    });
});
