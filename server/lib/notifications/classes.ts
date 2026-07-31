/**
 * The notification CLASS vocabulary — one id per kind of notification we send,
 * and the single answer to "may this be switched off at all?".
 *
 * Two different surfaces were already asking that question and neither could
 * see the other:
 *
 * - the OPERATOR axis — `renderer.ts` reads `descriptor.required` to decide
 *   whether a tenant may disable a template for everybody
 * - the RECIPIENT axis — the preferences screen, which is why this file exists
 *
 * They are the same underlying question. A notification that must reach someone
 * for legal or operational reasons must not be suppressible by EITHER party, so
 * there is one flag and both read it. Keeping them separate would let a tenant
 * disable the password-reset email that a recipient is told is "always sent".
 *
 * `required: true` means: switching this off locks the recipient out of their
 * account, hides money they owe or are owed, or destroys their only copy of
 * something they signed. It is not a synonym for "important".
 *
 * The authority for each value is the inventory in
 * `docs/superpowers/specs/2026-07-31-notification-preferences-design.md` §2.
 * `classes.test.ts` makes that authority executable: every class must be placed
 * in one of two explicit lists, so a new notification cannot be added without
 * someone deciding which it is.
 */
import type { AutomationChannel } from '../../services/automation/shared';

export type NotificationCategory = 'transactional' | 'operational' | 'marketing';

export interface NotificationClass {
    /** Stable id. For registry-backed email this IS the template trigger. */
    id: string;
    /** Recipient-facing name. Not the operator's shorthand. */
    label: string;
    category: NotificationCategory;
    /** May this be switched off at all — by the operator OR the recipient? */
    required: boolean;
    channels: AutomationChannel[];
}

export const NOTIFICATION_CLASSES: NotificationClass[] = [
    // ─── account access (spec §2.0) — every one of these is the delivery
    // mechanism for getting INTO the account, so none may be switched off.
    { id: 'password-reset',       label: 'Password reset',          category: 'transactional', required: true,  channels: ['email'] },
    { id: 'workspace-invitation', label: 'Workspace invitation',    category: 'transactional', required: true,  channels: ['email'] },
    { id: 'agent-invite',         label: 'Partner agent invite',    category: 'transactional', required: true,  channels: ['email'] },
    { id: 'agent-login-link',     label: 'Agent sign-in link',      category: 'transactional', required: true,  channels: ['email'] },
    // No registry entry yet — the route hand-builds the HTML. P3 converts it;
    // the class exists now so the gate can already see it (spec §2.0 #9).
    { id: 'client-portal-login',  label: 'Client portal sign-in link', category: 'transactional', required: true, channels: ['email'] },

    // ─── money and legal record (spec §2.1)
    { id: 'agreement-request',    label: 'Agreement to sign',       category: 'transactional', required: true,  channels: ['email'] },
    { id: 'agreement-signed',     label: 'Your signed agreement',   category: 'transactional', required: true,  channels: ['email'] },
    { id: 'evidence-pack',        label: 'Signature certificate',   category: 'transactional', required: true,  channels: ['email'] },
    { id: 'payment-request',      label: 'Invoice',                 category: 'transactional', required: true,  channels: ['email'] },
    { id: 'report-ready',         label: 'Your report is ready',    category: 'transactional', required: true,  channels: ['email'] },
    { id: 'report-ready-pdf',     label: 'Your report (PDF)',       category: 'transactional', required: true,  channels: ['email'] },

    // ─── the workspace can no longer do its job (spec §2.6 shape)
    // Warns the owner they are at / near the free-tier inspection limit. Muting
    // it means hitting the wall with no warning, which is the same harm as
    // hiding money owed — so it is not the recipient's to switch off. SaaS only;
    // standalone has no quota (spec §2.6b).
    // Found while converting call sites, NOT by the §5.0 route census: it is a
    // hand-built send INSIDE the email service, where a sweep of routes cannot
    // see it. Add it to the spec's §2.4b list.
    { id: 'usage-quota-warning',  label: 'Free inspections running out', category: 'operational', required: true, channels: ['email'] },

    // ─── your inspection (spec §2.2) — the recipient may switch these off
    { id: 'booking-confirmation', label: 'Booking confirmation',    category: 'transactional', required: false, channels: ['email', 'sms'] },
    { id: 'message-notification', label: 'New message from your inspector', category: 'transactional', required: false, channels: ['email', 'in_app'] },
    { id: 'agent-share-link',     label: 'Shared report link',      category: 'transactional', required: false, channels: ['email'] },

    // ─── agent notifications (spec §2.3) — already recipient-controlled today
    // via notifyOnReferral / notifyOnReport / notifyOnPaid.
    { id: 'agent-new-referral',   label: 'A new referral is booked', category: 'transactional', required: false, channels: ['email'] },
    { id: 'agent-report-ready',   label: 'A report is ready to read', category: 'transactional', required: false, channels: ['email'] },
    { id: 'agent-invoice-paid',   label: 'An invoice is paid',      category: 'transactional', required: false, channels: ['email'] },

    // ─── concierge (spec §2.4)
    { id: 'concierge-client-confirm',    label: 'Booking confirmed',            category: 'transactional', required: false, channels: ['email'] },
    { id: 'concierge-inspector-review',  label: 'A booking needs your review',  category: 'operational',   required: false, channels: ['email'] },
    { id: 'concierge-confirmed-agent',   label: 'Booking confirmed',            category: 'transactional', required: false, channels: ['email'] },
    { id: 'concierge-cancelled-agent',   label: 'Booking cancelled',            category: 'transactional', required: false, channels: ['email'] },
];

const BY_ID = new Map(NOTIFICATION_CLASSES.map((c) => [c.id, c]));

export function notificationClass(id: string): NotificationClass | undefined {
    return BY_ID.get(id);
}

/**
 * Fail-CLOSED: an unknown class is treated as required, so a notification that
 * has not been classified yet can never be silently suppressed by a preference.
 * The gate below makes "unknown" a build failure rather than a runtime one, but
 * the runtime default must still be the safe direction.
 */
export function isSuppressible(id: string): boolean {
    return BY_ID.get(id)?.required === false;
}
