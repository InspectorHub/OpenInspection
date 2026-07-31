/**
 * The §2 inventory, made executable.
 *
 * A spec table and a code constant that are meant to agree, but are only asked
 * to agree by prose, will drift — `settings-automations.test.ts` was written
 * days ago for exactly this failure, after a channel was added to the schema
 * and the route's filter silently dropped it.
 *
 * So three couplings are asserted here rather than described:
 *
 *  1. every email template the code can send has a class
 *  2. the OPERATOR's kill switch (`descriptor.required`, read by renderer.ts)
 *     and the RECIPIENT's kill switch (`class.required`) agree — otherwise a
 *     tenant could disable a notification the screen promises is always sent
 *  3. every class is placed in one of the two lists below, so adding a
 *     notification without deciding whether it may be muted FAILS
 *
 * (3) is the one that matters over time. (1) and (2) catch today's mistakes;
 * (3) catches the ones nobody has made yet.
 */
import { describe, it, expect } from 'vitest';
import { NOTIFICATION_CLASSES, isSuppressible, notificationClass } from '../../../server/lib/notifications/classes';
import { REGISTRY } from '../../../server/lib/email-templates/registry';

/**
 * Spec §2.0 + §2.1 — switching any of these off locks the recipient out of
 * their account, hides money, or destroys their only copy of something they
 * signed. Sourced from the inventory, not from what the code happens to do.
 */
const NEVER_OFF = [
    'password-reset', 'workspace-invitation', 'agent-invite', 'agent-login-link',
    'client-portal-login',
    'agreement-request', 'agreement-signed', 'evidence-pack', 'payment-request',
    'report-ready', 'report-ready-pdf',
    // Not §2.0/§2.1 but the same harm: muting it means the workspace hits the
    // free-tier wall with no warning.
    'usage-quota-warning', 'usage-quota-reached',
    // A one-off share to a typed-in address: no account, no relationship, so no
    // preference can exist. See the third `required: true` case in classes.ts.
    'repair-request-share',
];

/** Spec §2.2-§2.4 — the recipient's call. */
const RECIPIENT_MAY_MUTE = [
    'booking-confirmation', 'message-notification', 'agent-share-link',
    'agent-new-referral', 'agent-report-ready', 'agent-invoice-paid',
    'concierge-client-confirm', 'concierge-inspector-review',
    'concierge-confirmed-agent', 'concierge-cancelled-agent',
];

describe('notification classes', () => {
    it('classifies every notification — a new one cannot arrive undecided', () => {
        const decided = new Set([...NEVER_OFF, ...RECIPIENT_MAY_MUTE]);
        const undecided = NOTIFICATION_CLASSES.filter((c) => !decided.has(c.id)).map((c) => c.id);
        expect(undecided, 'add these to NEVER_OFF or RECIPIENT_MAY_MUTE — the decision is the point').toEqual([]);
    });

    it('never lists a class twice, in the lists or in the vocabulary', () => {
        const ids = NOTIFICATION_CLASSES.map((c) => c.id);
        expect(new Set(ids).size).toBe(ids.length);
        const both = NEVER_OFF.filter((id) => RECIPIENT_MAY_MUTE.includes(id));
        expect(both).toEqual([]);
    });

    it('marks every account-access and money/record class as required', () => {
        for (const id of NEVER_OFF) {
            expect(notificationClass(id), `${id} has no class`).toBeDefined();
            expect(isSuppressible(id), `${id} must not be suppressible`).toBe(false);
        }
    });

    it('lets the recipient mute everything else', () => {
        for (const id of RECIPIENT_MAY_MUTE) {
            expect(isSuppressible(id), `${id} should be the recipient's call`).toBe(true);
        }
    });

    it('gives every email template a class — the send boundary has to name one', () => {
        const missing = REGISTRY.filter((d) => !notificationClass(d.trigger)).map((d) => d.trigger);
        expect(missing).toEqual([]);
    });

    it('agrees with the operator kill switch renderer.ts reads', () => {
        // renderer.ts: `const enabled = d.required ? true : (override?.enabled ?? true)`.
        // If these two ever disagree, a tenant can disable a notification this
        // codebase tells the recipient is always sent.
        const disagree = REGISTRY
            .filter((d) => notificationClass(d.trigger)!.required !== d.required)
            .map((d) => `${d.trigger}: registry=${d.required} class=${notificationClass(d.trigger)!.required}`);
        expect(disagree).toEqual([]);
    });

    it('treats an unknown class as required — fail closed, never fail quiet', () => {
        expect(isSuppressible('some.future.notification')).toBe(false);
    });
});
