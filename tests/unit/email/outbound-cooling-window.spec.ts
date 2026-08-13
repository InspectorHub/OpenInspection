/**
 * Portal #98 §3.2 — the cooling-window POLICY, with no database in it.
 *
 * The load-bearing assertion is the first one. A typo in ACCOUNT_EMAIL_CLASSES
 * does not fail loudly: the id simply never matches, the class stays GATED, and
 * a brand-new company silently cannot receive a password-reset email. Nothing
 * else in the system would notice. So the list is checked against the class
 * registry itself.
 */
import { describe, it, expect } from 'vitest';
import {
    ACCOUNT_EMAIL_CLASSES,
    COOLING_WINDOW_HOURS,
    COOLING_WINDOW_MS,
    coolingWindowApplies,
    isAccountEmailClass,
    unlockAtMs,
} from '../../../server/lib/email/outbound-cooling-window';
import { notificationClass } from '../../../server/lib/notifications/classes';
import { SAAS_PROFILE, STANDALONE_PROFILE } from '../../../server/lib/deployment-profile';

describe('account-email exemption list', () => {
    it('every exempt id is a real notification class (a typo would silently gate it)', () => {
        const unknown = [...ACCOUNT_EMAIL_CLASSES].filter((id) => notificationClass(id) === undefined);
        expect(unknown).toEqual([]);
    });

    it('exempts the credential-delivery classes', () => {
        expect(isAccountEmailClass('password-reset')).toBe(true);
        expect(isAccountEmailClass('workspace-invitation')).toBe(true);
    });

    it('gates outbound to external recipients', () => {
        for (const id of ['report-ready', 'report-ready-pdf', 'agreement-request', 'payment-request', 'review-request']) {
            expect(isAccountEmailClass(id)).toBe(false);
        }
    });

    it('gates a send that never named itself', () => {
        // A tenant-written automation rule reaches the boundary with no classId.
        // Automations are explicitly in scope (spec §3.2), so undefined is GATED.
        expect(isAccountEmailClass(undefined)).toBe(false);
    });

    it('gates the admin test send, which takes an arbitrary typed-in address', () => {
        expect(isAccountEmailClass('admin-test-send')).toBe(false);
    });
});

describe('coolingWindowApplies', () => {
    it('applies only to a SaaS deployment funding the send itself', () => {
        expect(coolingWindowApplies({ profile: SAAS_PROFILE, platformFunded: true })).toBe(true);
    });

    it('does not apply to a self-hosted deployment on its own credentials', () => {
        expect(coolingWindowApplies({ profile: STANDALONE_PROFILE, platformFunded: true })).toBe(false);
    });

    it("does not apply to a tenant's own provider even on SaaS", () => {
        expect(coolingWindowApplies({ profile: SAAS_PROFILE, platformFunded: false })).toBe(false);
    });
});

describe('unlockAtMs', () => {
    it('is exactly 24 hours after the tenant row was written', () => {
        expect(COOLING_WINDOW_HOURS).toBe(24);
        expect(COOLING_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
        expect(unlockAtMs(1_700_000_000_000)).toBe(1_700_000_000_000 + COOLING_WINDOW_MS);
    });
});
