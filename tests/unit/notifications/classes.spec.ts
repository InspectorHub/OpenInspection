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
    // Only ever sent to whoever pressed the button — see `recipientFacing`.
    // Nobody else can have a preference about it.
    'admin-test-send',
    // §2.5 — work notifications to employees. The company decides; an
    // individual cannot mute their own dispatch. The operator's control is the
    // automation rule's own active flag, not this field.
    'inspector-payment-received', 'inspector-agreement-signed',
    'inspector-agreement-declined', 'inspector-agreement-viewed',
    'office-alert-new-booking', 'office-alert-inspection-scheduled',
    'office-alert-inspection-confirmed', 'office-alert-inspection-cancelled',
    'office-alert-inspection-completed', 'office-alert-report-published',
    'office-alert-invoice-created', 'office-alert-payment-received',
    'office-alert-agreement-signed',
];

/** Spec §2.2-§2.4 — the recipient's call. */
const RECIPIENT_MAY_MUTE = [
    'booking-confirmation', 'message-notification', 'agent-share-link',
    'agent-new-referral', 'agent-report-ready', 'agent-invoice-paid',
    'concierge-client-confirm', 'concierge-inspector-review',
    'concierge-confirmed-agent', 'concierge-cancelled-agent',
    // §2.2 / §2.3 — seeded automation rules the recipient may switch off.
    // §5.3 settles the sharpest pair outright: report-ready is required,
    // post-inspection-followup and review-request are not.
    'inspection-reminder', 'inspection-cancelled', 'report-amended',
    'report-ready-listing-agent', 'booking-confirmation-buyers-agent',
    'report-amended-buyers-agent', 'event-reminder', 'event-followup',
    'event-results-received', 'event-results-received-buyers-agent',
    'post-inspection-followup', 'review-request',
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

    it('uses only the three categories §3.1 fixes — a compliance taxonomy, not a free field', () => {
        // transactional / operational / marketing is the vocabulary CAN-SPAM and
        // GDPR reason in: it says what the CONTENT is. A fourth value was once
        // added here to mean "only the sender receives it", which is a fact
        // about the AUDIENCE — two different questions sharing one field. That
        // belongs on `recipientFacing`, and this keeps it there.
        const allowed = new Set(['transactional', 'operational', 'marketing']);
        const rogue = NOTIFICATION_CLASSES.filter((c) => !allowed.has(c.category)).map((c) => `${c.id}: ${c.category}`);
        expect(rogue).toEqual([]);
    });

    it('keeps a non-recipient-facing class out of the screen, without hiding it from the boundary', () => {
        const testSend = notificationClass('admin-test-send')!;
        expect(testSend.recipientFacing).toBe(false);
        // Everything a recipient can actually receive stays on the screen.
        const hidden = NOTIFICATION_CLASSES.filter((c) => c.recipientFacing === false).map((c) => c.id);
        expect(hidden).toEqual(['admin-test-send']);
    });

    it('treats an unknown class as required — fail closed, never fail quiet', () => {
        expect(isSuppressible('some.future.notification')).toBe(false);
    });
});
