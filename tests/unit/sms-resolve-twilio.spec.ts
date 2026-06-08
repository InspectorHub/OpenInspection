import { describe, it, expect } from 'vitest';
import { resolveTwilio, resolveTwilioSource } from '../../server/lib/sms/resolve-twilio';

const PLATFORM = { TWILIO_ACCOUNT_SID: 'ACplatform', TWILIO_AUTH_TOKEN: 'tokP', TWILIO_FROM_NUMBER: '+1999' };
const OWN = { TWILIO_ACCOUNT_SID: 'ACown', TWILIO_AUTH_TOKEN: 'tokO', TWILIO_FROM_NUMBER: '+1888' };

describe('resolveTwilio — explicit mode toggle (mirrors email)', () => {
    it("mode=own + all three keys → own wins", () => {
        expect(resolveTwilio('own', OWN, PLATFORM)).toEqual({ sid: 'ACown', token: 'tokO', from: '+1888' });
    });
    it('mode=own but a key missing → platform fallback', () => {
        expect(resolveTwilio('own', { TWILIO_ACCOUNT_SID: 'ACown' }, PLATFORM))
            .toEqual({ sid: 'ACplatform', token: 'tokP', from: '+1999' });
    });
    it('mode=platform → platform env even if tenant keys present', () => {
        expect(resolveTwilio('platform', OWN, PLATFORM)).toEqual({ sid: 'ACplatform', token: 'tokP', from: '+1999' });
    });
    it('no platform env and mode=platform → null (fail-closed)', () => {
        expect(resolveTwilio('platform', {}, {})).toBeNull();
    });
    it('standalone: mode=platform but only tenant keys set → tenant as last resort', () => {
        expect(resolveTwilio('platform', OWN, {})).toEqual({ sid: 'ACown', token: 'tokO', from: '+1888' });
    });
});

describe('resolveTwilioSource — effective-source label (Settings UI, no secrets)', () => {
    it('mode=own + complete tenant creds → own', () => {
        expect(resolveTwilioSource('own', OWN, PLATFORM)).toBe('own');
    });
    it('mode=own but a key missing → platform', () => {
        expect(resolveTwilioSource('own', { TWILIO_ACCOUNT_SID: 'ACown' }, PLATFORM)).toBe('platform');
    });
    it('mode=platform with platform env → platform', () => {
        expect(resolveTwilioSource('platform', OWN, PLATFORM)).toBe('platform');
    });
    it('standalone: mode=platform but only tenant keys → own (last resort)', () => {
        expect(resolveTwilioSource('platform', OWN, {})).toBe('own');
    });
    it('no creds anywhere → none (fail-closed)', () => {
        expect(resolveTwilioSource('platform', {}, {})).toBe('none');
        expect(resolveTwilioSource('own', {}, {})).toBe('none');
    });
});
