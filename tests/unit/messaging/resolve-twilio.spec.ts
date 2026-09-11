import { describe, it, expect } from 'vitest';
import { resolveTwilio, resolveTwilioSource } from '../../../server/lib/sms/resolve-twilio';
import type { ManagedBag } from '../../../server/lib/sms/resolve-twilio';

const PLATFORM: Parameters<typeof resolveTwilio>[2] = {
    TWILIO_ACCOUNT_SID: 'ACplat',
    TWILIO_AUTH_TOKEN: 'plat-tok',
    TWILIO_FROM_NUMBER: '+10000000000',
};

const OWN: Parameters<typeof resolveTwilio>[1] = {
    TWILIO_ACCOUNT_SID: 'ACown',
    TWILIO_AUTH_TOKEN: 'own-tok',
    TWILIO_FROM_NUMBER: '+19999999999',
};

const COMPLETE_MANAGED: ManagedBag = {
    sid: 'ACmain',
    token: 'api-secret',
    authSid: 'SKkey',
    messagingServiceSid: 'MGtenant',
};

// ─── Managed branch ────────────────────────────────────────────────────────────

describe('resolveTwilio — managed branch', () => {
    it('managed_dedicated + complete managed bag → returns managed TwilioCreds with authSid + messagingServiceSid', () => {
        const out = resolveTwilio('managed_dedicated', {}, PLATFORM, COMPLETE_MANAGED);
        expect(out).toEqual({
            sid: 'ACmain',
            token: 'api-secret',
            from: '',
            authSid: 'SKkey',
            messagingServiceSid: 'MGtenant',
        });
    });

    it('managed_shared + complete managed bag → returns managed TwilioCreds', () => {
        const out = resolveTwilio('managed_shared', {}, PLATFORM, COMPLETE_MANAGED);
        expect(out).toEqual({
            sid: 'ACmain',
            token: 'api-secret',
            from: '',
            authSid: 'SKkey',
            messagingServiceSid: 'MGtenant',
        });
    });

    it('managed_dedicated + no managed bag → falls through to platform creds', () => {
        const out = resolveTwilio('managed_dedicated', {}, PLATFORM);
        expect(out).toEqual({ sid: 'ACplat', token: 'plat-tok', from: '+10000000000' });
    });

    it('managed_dedicated + incomplete managed bag (missing messagingServiceSid) → falls through to platform', () => {
        const incomplete = { ...COMPLETE_MANAGED, messagingServiceSid: '' };
        const out = resolveTwilio('managed_dedicated', {}, PLATFORM, incomplete);
        expect(out).toEqual({ sid: 'ACplat', token: 'plat-tok', from: '+10000000000' });
    });

    it('managed_dedicated + incomplete managed bag (missing authSid) → falls through to platform', () => {
        const incomplete = { ...COMPLETE_MANAGED, authSid: '' };
        const out = resolveTwilio('managed_dedicated', {}, PLATFORM, incomplete);
        expect(out).toEqual({ sid: 'ACplat', token: 'plat-tok', from: '+10000000000' });
    });

    it('managed_dedicated + complete managed bag with a from number → propagates from', () => {
        const withFrom: ManagedBag = { ...COMPLETE_MANAGED, from: '+12223334444' };
        const out = resolveTwilio('managed_dedicated', {}, PLATFORM, withFrom);
        expect(out?.from).toBe('+12223334444');
    });
});

// ─── Own / platform (regression) ───────────────────────────────────────────────

describe('resolveTwilio — own/platform modes (regression: unchanged behavior)', () => {
    it('own mode + complete tenant creds → returns own creds (not platform)', () => {
        const out = resolveTwilio('own', OWN, PLATFORM);
        expect(out?.sid).toBe('ACown');
        expect(out?.token).toBe('own-tok');
        expect(out?.authSid).toBeUndefined();
    });

    it('own mode + incomplete tenant creds → falls through to platform', () => {
        const out = resolveTwilio('own', { TWILIO_ACCOUNT_SID: 'ACown' }, PLATFORM);
        expect(out?.sid).toBe('ACplat');
    });

    it('platform mode → always platform creds regardless of tenant creds', () => {
        const out = resolveTwilio('platform', OWN, PLATFORM);
        expect(out?.sid).toBe('ACplat');
    });

    it('platform mode → null when no platform creds and no tenant fallback', () => {
        const out = resolveTwilio('platform', {}, {});
        expect(out).toBeNull();
    });

    it('standalone fallback: no platform creds but tenant has own keys → returns tenant', () => {
        // Mirrors the standalone-operator case: no platform env, but tenant set keys via UI.
        const out = resolveTwilio('platform', OWN, {});
        expect(out?.sid).toBe('ACown');
    });
});

// ─── resolveTwilioSource (moved from sms-resolve-twilio.spec.ts — deduped) ─────

const SOURCE_PLATFORM = { TWILIO_ACCOUNT_SID: 'ACplatform', TWILIO_AUTH_TOKEN: 'tokP', TWILIO_FROM_NUMBER: '+1999' };
const SOURCE_OWN = { TWILIO_ACCOUNT_SID: 'ACown', TWILIO_AUTH_TOKEN: 'tokO', TWILIO_FROM_NUMBER: '+1888' };

describe('resolveTwilioSource — effective-source label (Settings UI, no secrets)', () => {
    it('mode=own + complete tenant creds → own', () => {
        expect(resolveTwilioSource('own', SOURCE_OWN, SOURCE_PLATFORM)).toBe('own');
    });
    it('mode=own but a key missing → platform', () => {
        expect(resolveTwilioSource('own', { TWILIO_ACCOUNT_SID: 'ACown' }, SOURCE_PLATFORM)).toBe('platform');
    });
    it('mode=platform with platform env → platform', () => {
        expect(resolveTwilioSource('platform', SOURCE_OWN, SOURCE_PLATFORM)).toBe('platform');
    });
    it('standalone: mode=platform but only tenant keys → own (last resort)', () => {
        expect(resolveTwilioSource('platform', SOURCE_OWN, {})).toBe('own');
    });
    it('no creds anywhere → none (fail-closed)', () => {
        expect(resolveTwilioSource('platform', {}, {})).toBe('none');
        expect(resolveTwilioSource('own', {}, {})).toBe('none');
    });
});

/**
 * F58 — this label function had NO managed branch while `resolveTwilio` did, so
 * it described a credential set the sender does not use. A `managed_shared`
 * tenant got `none` whenever the platform had no `TWILIO_FROM_NUMBER` — whether
 * or not the managed pool the send actually goes through was configured — and
 * Settings then told that tenant to supply credentials of their own, on a panel
 * managed mode does not even render.
 *
 * Every case below is paired with the same call to `resolveTwilio`, because the
 * defect was not a wrong answer, it was two functions answering differently.
 * Asserting this one against a literal would have passed before and after.
 */
describe('resolveTwilioSource — managed tiers (F58)', () => {
    for (const mode of ['managed_shared', 'managed_dedicated'] as const) {
        it(`${mode} + a complete managed pool → managed, and agrees with the sender`, () => {
            expect(resolveTwilioSource(mode, {}, {}, COMPLETE_MANAGED)).toBe('managed');
            // The sender resolves the same input to the managed pool.
            expect(resolveTwilio(mode, {}, {}, COMPLETE_MANAGED)?.messagingServiceSid).toBe('MGtenant');
        });

        it(`${mode} with a complete pool is managed even when platform creds exist`, () => {
            // Previously 'platform' — the answer the sender never gives.
            expect(resolveTwilioSource(mode, SOURCE_OWN, SOURCE_PLATFORM, COMPLETE_MANAGED)).toBe('managed');
            expect(resolveTwilio(mode, SOURCE_OWN, SOURCE_PLATFORM, COMPLETE_MANAGED)?.authSid).toBe('SKkey');
        });

        it(`${mode} with NO managed pool and nothing else → none (this deployment)`, () => {
            // The walkthrough's actual state: the tenant sits on a managed tier
            // that the platform never provisioned. `none` is right here — what
            // was wrong was the UI telling the TENANT to fix it.
            expect(resolveTwilioSource(mode, {}, {}, undefined)).toBe('none');
            expect(resolveTwilio(mode, {}, {}, undefined)).toBeNull();
        });

        it(`${mode} with an INCOMPLETE managed pool falls through, never claiming managed`, () => {
            // One missing field at a time: each must fall through exactly as the
            // sender's own four-field guard does.
            for (const missing of ['sid', 'token', 'authSid', 'messagingServiceSid'] as const) {
                const partial: ManagedBag = { ...COMPLETE_MANAGED, [missing]: '' };
                expect(resolveTwilioSource(mode, {}, {}, partial)).not.toBe('managed');
                expect(resolveTwilio(mode, {}, {}, partial)?.messagingServiceSid).toBeUndefined();
            }
        });
    }

    it('never reports managed for a non-managed mode, pool or no pool', () => {
        expect(resolveTwilioSource('own', SOURCE_OWN, {}, COMPLETE_MANAGED)).toBe('own');
        expect(resolveTwilioSource('platform', {}, SOURCE_PLATFORM, COMPLETE_MANAGED)).toBe('platform');
    });
});
