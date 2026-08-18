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
import { NOTIFICATION_CLASSES, notificationClass } from '../../../server/lib/notifications/classes';
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

/**
 * Round 20 B2. The 24-hour hold survives review as an ABUSE control, on the
 * condition that it never impedes a statutory right. A person exercising access
 * or erasure has a deadline that runs against the controller, and an outbound
 * queue is not a lawful reason to spend a day of it — least of all in the first
 * 24 hours of a company's life, which is exactly when a brand-new tenant's first
 * subject request would land.
 *
 * These two are NOT on the list for the reason the other four are. The others
 * are account mechanics — mail that hands someone the keys to a product they
 * just paid for. These carry a right that exists whether or not the product
 * does, and counsel drew that line explicitly.
 */
describe('statutory-rights messages are never held', () => {
    const STATUTORY_RIGHTS = ['subject-export-ready', 'subject-erasure-confirmed'] as const;

    it('the two ids are real notification classes, required, and transactional', () => {
        // CROSS-TASK: these classes are minted by the messaging-consent plan's
        // class task. Until it lands this is RED, and that is the intended
        // wiring — the two tasks agree on the literal strings or they do not
        // ship. A silently-gated statutory right is the failure being prevented,
        // so the check is deliberately not tolerant of a missing class.
        for (const id of STATUTORY_RIGHTS) {
            const cls = NOTIFICATION_CLASSES.find((c) => c.id === id);
            expect(cls, `${id} is not in NOTIFICATION_CLASSES`).toBeDefined();
            expect(cls?.required, `${id} must not be suppressible`).toBe(true);
            expect(cls?.category, `${id} is not marketing`).toBe('transactional');
        }
    });

    it('neither is held by the cooling window', () => {
        for (const id of STATUTORY_RIGHTS) {
            expect(isAccountEmailClass(id), `${id} is being held`).toBe(true);
        }
    });

    it('an external sign-in link is still held — the hold has not been widened', () => {
        // The positive control. Exempting the two above must not have loosened
        // the rule for the phishing-shaped payload the window exists to delay.
        expect(isAccountEmailClass('client-portal-login')).toBe(false);
        expect(isAccountEmailClass('agent-login-link')).toBe(false);
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
