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
 * One more case earns it, found while converting the hand-built sends: a
 * ONE-OFF transmission the sender explicitly asked for, to an address they
 * typed, where the recipient has no account and no ongoing relationship with
 * us. A preference is a standing choice about a stream; a single share is not a
 * stream, so there is no preference to express and nowhere to store one. The
 * only thing "suppressible" could mean there is the operator switch — which
 * would make a send button report success and do nothing.
 *
 * The authority for each value is the inventory in
 * `docs/superpowers/specs/2026-07-31-notification-preferences-design.md` §2.
 * `classes.test.ts` makes that authority executable: every class must be placed
 * in one of two explicit lists, so a new notification cannot be added without
 * someone deciding which it is.
 */
import type { AutomationChannel } from '../../services/automation/shared';

/**
 * The three values spec §3.1 fixes. This is a COMPLIANCE taxonomy — the
 * vocabulary CAN-SPAM and GDPR reason in — describing what the content IS.
 *
 * A fourth value was briefly added here for the admin test send, and that was
 * wrong: "only ever reaches whoever pressed the button" is a fact about the
 * AUDIENCE, not a content type. Putting it here would have made the taxonomy
 * mean two things at once. It lives on `recipientFacing` instead.
 */
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
    /**
     * Does anyone RECEIVE this by being someone? Default true; omitted
     * everywhere it is.
     *
     * `false` means the only recipient is whoever triggered it, so there is no
     * standing relationship a preference could attach to — the preferences
     * screen leaves it out. The class still exists because the send boundary
     * must be able to name what it is sending, and "nothing" is not an answer.
     */
    recipientFacing?: boolean;
    /**
     * What "no row" means for this class. Default TRUE — we send unless told
     * otherwise — and omitted everywhere it is.
     *
     * `false` exists because one notification was off by default before this
     * table did: the agent invoice-paid mail. Without this field, migrating it
     * had only bad answers — write a mute row for every user (the table then
     * grows with the user base rather than with the decisions, §3.2), or drop
     * the default and start sending mail nobody asked for.
     *
     * Absence still means "the class default"; this is what the class default
     * IS.
     */
    defaultEnabled?: boolean;
    /**
     * WHOSE screen this belongs on — §2's "Who" column, made executable.
     *
     * §2 has two columns the code has to honour. "Off?" became `required`;
     * this is the other one, and the screen needs it: a client must not be
     * shown "Office alert — new booking", and a preferences page that lists
     * notifications the reader can never receive answers neither of the two
     * questions §4 says it must.
     *
     * An EMPTY array means no one's screen. `repair-request-share` is the only
     * one: it goes to an address someone typed, so there is no account to show
     * it on — the same reason it is `required` (see the header).
     */
    audience: Audience[];
}

/**
 * The three readers OI has. `subscriber` (§2.6) is portal-owned and never
 * renders here — see §2.6b, where the same notification belongs to a different
 * system depending on the deployment.
 */
export type Audience = 'client' | 'agent' | 'staff';

export const NOTIFICATION_CLASSES: NotificationClass[] = [
    // ─── account access (spec §2.0) — every one of these is the delivery
    // mechanism for getting INTO the account, so none may be switched off.
    { id: 'password-reset',       label: 'Password reset',          category: 'transactional', required: true,  channels: ['email'], audience: ['staff', 'agent'] },
    { id: 'workspace-invitation', label: 'Workspace invitation',    category: 'transactional', required: true,  channels: ['email'], audience: ['staff'] },
    { id: 'agent-invite',         label: 'Partner agent invite',    category: 'transactional', required: true,  channels: ['email'], audience: ['agent'] },
    { id: 'agent-login-link',     label: 'Agent sign-in link',      category: 'transactional', required: true,  channels: ['email'], audience: ['agent'] },
    { id: 'client-portal-login',  label: 'Client portal sign-in link', category: 'transactional', required: true, channels: ['email'], audience: ['client'] },

    // ─── money and legal record (spec §2.1)
    { id: 'agreement-request',    label: 'Agreement to sign',       category: 'transactional', required: true,  channels: ['email'], audience: ['client'] },
    { id: 'agreement-signed',     label: 'Your signed agreement',   category: 'transactional', required: true,  channels: ['email'], audience: ['client'] },
    { id: 'evidence-pack',        label: 'Signature certificate',   category: 'transactional', required: true,  channels: ['email'], audience: ['client'] },
    { id: 'payment-request',      label: 'Invoice',                 category: 'transactional', required: true,  channels: ['email'], audience: ['client'] },
    // The receipt for a payment already made. Required for the same reason the
    // invoice is: it is the only record we produce of money that changed hands,
    // and muting it hides money the recipient has paid.
    { id: 'payment-receipt',      label: 'Your payment receipt',    category: 'transactional', required: true,  channels: ['email'], audience: ['client'] },

    // ─── statutory rights (round 20 B2)
    // Two messages the engine did not have. The erasure orchestrator and the
    // subject-export service are API-only: they do the work, write the
    // accountability record, and tell nobody — so a data subject who asked to
    // be forgotten learned the outcome from the absence of further contact,
    // which is indistinguishable from having been ignored.
    //
    // `required` because a person cannot mute the confirmation that their own
    // erasure happened. Honouring a preference that hid a statutory act from
    // the only person it concerns would be the wrong way round.
    { id: 'subject-export-ready',      label: 'Your copy of your data is ready', category: 'transactional', required: true, channels: ['email'], audience: ['client', 'agent', 'staff'] },
    { id: 'subject-erasure-confirmed', label: 'Your erasure request is complete', category: 'transactional', required: true, channels: ['email'], audience: ['client', 'agent', 'staff'] },
    // `sms` is here because the product TEXTS this, and five seeded automations
    // carrying an smsBody mapped to classes that said email only. For the four
    // non-required ones the screen was unaffected — screen-model.ts renders
    // every channel for a class the reader can switch, deliberately. This one is
    // REQUIRED, so it appears in `alwaysSent`, which reads `channels` verbatim:
    // it was telling a client "we always send you this by email" while also
    // texting them, with no switch to compensate.
    { id: 'report-ready',         label: 'Your report is ready',    category: 'transactional', required: true,  channels: ['email', 'sms'], audience: ['client'] },
    { id: 'report-ready-pdf',     label: 'Your report (PDF)',       category: 'transactional', required: true,  channels: ['email'], audience: ['client'] },
    // A one-off share to a typed-in address — see the third `required: true`
    // case in the header. Not "important enough to force"; there is simply no
    // standing relationship for a preference to attach to.
    { id: 'repair-request-share', label: 'Repair request shared with you', category: 'transactional', required: true, channels: ['email'], audience: [] },

    // ─── the workspace can no longer do its job (spec §2.6 shape)
    // Warns the owner they are at / near the free-tier inspection limit. Muting
    // it means hitting the wall with no warning, which is the same harm as
    // hiding money owed — so it is not the recipient's to switch off. SaaS only;
    // standalone has no quota (spec §2.6b).
    // Found while converting call sites, NOT by the §5.0 route census: it is a
    // hand-built send INSIDE the email service, where a sweep of routes cannot
    // see it. Add it to the spec's §2.4b list.
    //
    // Two ids, not one with a variable: "you have one left" and "you have none
    // left" are different messages, and a recipient reading a list of what we
    // send should see both.
    { id: 'usage-quota-warning',  label: 'Free inspections running out', category: 'operational', required: true, channels: ['email'], audience: ['staff'] },
    { id: 'usage-quota-reached',  label: 'Free inspections used up',     category: 'operational', required: true, channels: ['email'], audience: ['staff'] },

    // A destruction that did not finish, told to the controller.
    //
    // `required: true` is not a formality here. This is a message about the
    // failure to complete an erasure the recipient asked for, sent under round
    // 22 without undue delay after the failure is known; a preference that
    // could switch it off would let a workspace opt out of being told its own
    // data still exists. It is also the one class whose recipient's workspace
    // no longer exists by the time it sends — which is why the address is
    // resolved before the cascade rather than at the boundary.
    { id: 'destruction-incomplete', label: 'Workspace deletion did not finish', category: 'operational', required: true, channels: ['email'], audience: ['staff'] },

    // ─── an import somebody sent us to convert
    // Operational and `required`, for the reason the quota notices are: this is
    // the platform telling a workspace owner how a file they themselves handed
    // over is being handled. Two of the four report that something is about to
    // be lost if they do nothing, and a preference that hid those would be a
    // preference to be surprised.
    //
    // Email only, with no in-app twin. The recipient is someone in the middle
    // of moving in — precisely when they are not yet signing in daily — so a
    // notice on a screen they have not opened is not a notice.
    { id: 'migration-import-received', label: 'We have your import file', category: 'operational', required: true, channels: ['email'], audience: ['staff'] },
    { id: 'migration-import-ready',    label: 'Your import is ready to review', category: 'operational', required: true, channels: ['email'], audience: ['staff'] },
    { id: 'migration-import-declined', label: 'Your import could not be converted', category: 'operational', required: true, channels: ['email'], audience: ['staff'] },
    { id: 'migration-import-expiring', label: 'An import is about to be cleared', category: 'operational', required: true, channels: ['email'], audience: ['staff'] },

    // ─── not a notification to anyone but the sender
    // An admin sending their own message template to their own address to see
    // what it looks like. Classified so the boundary is never handed a send it
    // cannot name; `recipientFacing: false` keeps it off the recipient screen.
    { id: 'admin-test-send',      label: 'Test send (admin)',            category: 'operational', required: true, channels: ['email', 'sms'], recipientFacing: false, audience: ['staff'] },

    // ─── your inspection (spec §2.2) — the recipient may switch these off
    { id: 'booking-confirmation', label: 'Booking confirmation',    category: 'transactional', required: false, channels: ['email', 'sms'], audience: ['client'] },
    { id: 'message-notification', label: 'New message from your inspector', category: 'transactional', required: false, channels: ['email', 'in_app'], audience: ['client'] },
    { id: 'agent-share-link',     label: 'Shared report link',      category: 'transactional', required: false, channels: ['email'], audience: ['agent'] },

    // ─── agent notifications (spec §2.3). These were three booleans on `users`
    // with their own gate in the email service; the columns are retired and the
    // send boundary is now the only place the choice is read. `agent-invoice-paid`
    // carries `defaultEnabled: false` because that column defaulted to false —
    // the default moved with the data rather than being quietly dropped.
    { id: 'agent-new-referral',   label: 'A new referral is booked', category: 'transactional', required: false, channels: ['email'], audience: ['agent'] },
    { id: 'agent-report-ready',   label: 'A report is ready to read', category: 'transactional', required: false, channels: ['email', 'sms'], audience: ['agent'] },
    { id: 'agent-invoice-paid',   label: 'An invoice is paid',      category: 'transactional', required: false, channels: ['email'], audience: ['agent'], defaultEnabled: false },

    // ─── automation rules the tenant did not write (spec §2.2, §2.3, §2.5)
    //
    // These are the SEEDED rules in `server/data/automation-seeds.ts` — every
    // scheduled or automatic send in the product lives there. The class is the
    // SEED's semantic identity, never its trigger: `report.published` alone
    // carries five different seeds, and three of them go to the same client
    // saying three different things. §5.3 settles the sharpest case outright —
    // "report-ready is required and post-inspection follow-up / review request
    // are not". A trigger-keyed class could not hold both answers.
    //
    // Seeds whose notification ALREADY has a class reuse it (Booking
    // Confirmation, Report Ready, Invoice, the two agreement ones): the manual
    // path and the automatic path are the same thing arriving, and two switches
    // for one notification is how a control comes to half-work.
    //
    // The staff and inspector ones are `required` because §2.5 marks them
    // Operator, not You: an individual cannot mute their own dispatch. The
    // operator's control is the RULE's own active flag, which is why one
    // `required` flag still suffices here.
    { id: 'inspection-reminder',          label: 'Reminder before your inspection', category: 'transactional', required: false, channels: ['email', 'sms'], audience: ['client'] },
    // email only: the Cancellation Notice seed carries no `smsBody`. §2.2 lists
    // sms for this row, but that is the channel the product INTENDS, not one it
    // has content for — and a switch for a message that can never be sent is a
    // control that lies.
    { id: 'inspection-cancelled',         label: 'Your inspection was cancelled',   category: 'transactional', required: false, channels: ['email'], audience: ['client'] },
    { id: 'inspection-cancelled-buyers-agent', label: 'An inspection you referred was cancelled', category: 'transactional', required: false, channels: ['email'], audience: ['agent'] },
    { id: 'report-amended',               label: 'Your report was updated',         category: 'transactional', required: false, channels: ['email', 'sms'], audience: ['client'] },
    { id: 'report-ready-listing-agent',   label: 'A report is ready (listing agent)', category: 'transactional', required: false, channels: ['email', 'sms'], audience: ['agent'] },
    { id: 'booking-confirmation-buyers-agent', label: 'An inspection you referred is booked', category: 'transactional', required: false, channels: ['email'], audience: ['agent'] },
    { id: 'report-amended-buyers-agent',  label: 'A report you follow was updated',  category: 'transactional', required: false, channels: ['email', 'sms'], audience: ['agent'] },
    { id: 'event-reminder',               label: 'Reminder before your appointment', category: 'transactional', required: false, channels: ['email'], audience: ['client'] },
    { id: 'event-followup',               label: 'Your results are ready',          category: 'transactional', required: false, channels: ['email'], audience: ['client'] },
    // Distinct from `event-followup`, which is timed off the pickup and says
    // "we expect results by now". This one fires when the lab result actually
    // landed, so a recipient who muted the estimate can still be told the fact.
    { id: 'event-results-received',       label: 'Your results have arrived',       category: 'transactional', required: false, channels: ['email', 'sms'], audience: ['client'] },
    { id: 'event-results-received-buyers-agent', label: 'Results you follow have arrived', category: 'transactional', required: false, channels: ['email', 'sms'], audience: ['agent'] },
    { id: 'post-inspection-followup',     label: 'Following up after your inspection', category: 'transactional', required: false, channels: ['email'], audience: ['client'] },
    { id: 'review-request',               label: 'How did we do?',                  category: 'marketing',     required: false, channels: ['email'], audience: ['client'] },

    // Inspector work notifications — §2.5, Operator's call, not the individual's.
    { id: 'inspector-payment-received',   label: 'A payment came in',               category: 'operational', required: true, channels: ['email'], audience: ['staff'] },
    { id: 'inspector-agreement-signed',   label: 'A client signed the agreement',   category: 'operational', required: true, channels: ['email'], audience: ['staff'] },
    { id: 'inspector-agreement-declined', label: 'A client declined the agreement', category: 'operational', required: true, channels: ['email'], audience: ['staff'] },
    { id: 'inspector-agreement-viewed',   label: 'A client opened the agreement',   category: 'operational', required: true, channels: ['email'], audience: ['staff'] },

    // Office alerts — nine events, nine classes. §2.5 lists them as one row for
    // brevity; they are nine distinct things that happened, and collapsing them
    // would be the same mistake as keying on the trigger.
    { id: 'office-alert-new-booking',             label: 'Office: a new booking arrived',      category: 'operational', required: true, channels: ['in_app'], audience: ['staff'] },
    { id: 'office-alert-inspection-scheduled',    label: 'Office: an inspection was scheduled', category: 'operational', required: true, channels: ['in_app'], audience: ['staff'] },
    { id: 'office-alert-inspection-confirmed',    label: 'Office: an inspection was confirmed', category: 'operational', required: true, channels: ['in_app'], audience: ['staff'] },
    { id: 'office-alert-inspection-cancelled',    label: 'Office: an inspection was cancelled', category: 'operational', required: true, channels: ['in_app'], audience: ['staff'] },
    { id: 'office-alert-inspection-completed',    label: 'Office: an inspection was completed', category: 'operational', required: true, channels: ['in_app'], audience: ['staff'] },
    { id: 'office-alert-report-published',        label: 'Office: a report was published',      category: 'operational', required: true, channels: ['in_app'], audience: ['staff'] },
    { id: 'office-alert-invoice-created',         label: 'Office: an invoice was created',      category: 'operational', required: true, channels: ['in_app'], audience: ['staff'] },
    { id: 'office-alert-payment-received',        label: 'Office: a payment was received',      category: 'operational', required: true, channels: ['in_app'], audience: ['staff'] },
    { id: 'office-alert-agreement-signed',        label: 'Office: an agreement was signed',     category: 'operational', required: true, channels: ['in_app'], audience: ['staff'] },

    // ─── concierge (spec §2.4)
    { id: 'concierge-client-confirm',    label: 'Booking confirmed',            category: 'transactional', required: false, channels: ['email'], audience: ['client'] },
    { id: 'concierge-inspector-review',  label: 'A booking needs your review',  category: 'operational',   required: false, channels: ['email'], audience: ['staff'] },
    { id: 'concierge-confirmed-agent',   label: 'Booking confirmed',            category: 'transactional', required: false, channels: ['email'], audience: ['agent'] },
    { id: 'concierge-cancelled-agent',   label: 'Booking cancelled',            category: 'transactional', required: false, channels: ['email'], audience: ['agent'] },
];

const BY_ID = new Map(NOTIFICATION_CLASSES.map((c) => [c.id, c]));

export function notificationClass(id: string): NotificationClass | undefined {
    return BY_ID.get(id);
}

/**
 * What a notification IS — the compliance taxonomy, asked from outside.
 *
 * `undefined` is deliberately NOT `'transactional'`. A caller that cannot
 * identify a class has to decide for itself what an unknown means, and on the
 * SMS path it means BLOCK: a default here would make every unrecognised class
 * id silently sendable on a consent that was never given for it. The one place
 * a default IS correct is `isSuppressible` below, and it defaults the other
 * way — to required — for the same fail-closed reason seen from the other side.
 */
export function categoryOf(id: string): NotificationCategory | undefined {
    return notificationClass(id)?.category;
}

/**
 * Fail-CLOSED: an unknown class is treated as required, so a notification that
 * has not been classified yet can never be silently suppressed by a preference.
 * The gate below makes "unknown" a build failure rather than a runtime one, but
 * the runtime default must still be the safe direction.
 */
/** What "no preference row" means for this class. */
export function defaultEnabled(id: string): boolean {
    return BY_ID.get(id)?.defaultEnabled !== false;
}

export function isSuppressible(id: string): boolean {
    return BY_ID.get(id)?.required === false;
}
