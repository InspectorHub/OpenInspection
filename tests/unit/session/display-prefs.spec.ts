import { describe, it, expect } from 'vitest';
import { resolveDisplayPrefs } from '../../../server/lib/session/display-prefs';

describe('display preference resolution', () => {
    it('prefers the user override', () => {
        expect(resolveDisplayPrefs(
            { dateFormat: 'iso', timeFormat: '24h' },
            { dateFormat: 'us', timeFormat: '12h' },
        )).toEqual({ dateFormat: 'iso', timeFormat: '24h' });
    });

    it('falls back per FIELD, not per object', () => {
        // A user who set only the clock must keep the tenant's date order.
        expect(resolveDisplayPrefs(
            { dateFormat: null, timeFormat: '24h' },
            { dateFormat: 'eu', timeFormat: '12h' },
        )).toEqual({ dateFormat: 'eu', timeFormat: '24h' });
    });

    it('defaults to today\'s rendering when the tenant row is missing', () => {
        expect(resolveDisplayPrefs(null, null)).toEqual({ dateFormat: 'us', timeFormat: '12h' });
    });

    it('ignores a stored value outside the enum', () => {
        // D1 stores plain TEXT — the drizzle enum is type-layer only, so a bad
        // row must not reach Intl as an unknown option key.
        expect(resolveDisplayPrefs(
            { dateFormat: 'dd.mm.yyyy', timeFormat: '36h' },
            { dateFormat: 'eu', timeFormat: '24h' },
        )).toEqual({ dateFormat: 'eu', timeFormat: '24h' });
    });
});
