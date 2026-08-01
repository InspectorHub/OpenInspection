/**
 * Which notification class a SEEDED automation rule is.
 *
 * Every scheduled or automatic send in the product is an automation rule, so
 * without this the whole rules layer reaches the send boundary unnamed — and a
 * preference cannot apply to something that cannot be named.
 *
 * KEYED ON THE SEED, NOT THE TRIGGER. The trigger is the obvious key and it is
 * wrong: `report.published` alone carries five seeds, three of them to the same
 * client, and they do not agree on whether they may be switched off — spec §5.3
 * settles it as "report-ready is required and post-inspection follow-up /
 * review request are not". One trigger-keyed class could not hold both answers.
 *
 * The key is `trigger::name`, which is exactly the identity `ensureSeeds` diffs
 * on. A rule renamed by a tenant would already be re-seeded as a new rule by
 * that mechanism, so this is no more fragile than what it sits beside.
 *
 * TENANT-CREATED RULES RETURN `undefined`, and that is a decision. They have no
 * code-owned identity, so there is no class, so a recipient cannot mute them —
 * but the operator can disable any rule outright (§5.3), so the control exists;
 * it is the operator's. An invented per-rule class would put a tenant's data in
 * a vocabulary the send boundary fails closed on.
 */

/** `${trigger}::${name}` → notification class id. */
const CLASS_BY_SEED: Record<string, string> = {
    // Seeds whose notification ALREADY has a class reuse it. The manual path
    // and the automatic path are the same thing arriving, and two switches for
    // one notification is how a control comes to half-work.
    'inspection.created::Booking Confirmation':                              'booking-confirmation',
    'report.published::Report Ready':                                        'report-ready',
    'invoice.created::Invoice / Payment Request':                            'payment-request',
    'inspection.created::Send agreement to client on inspection scheduled':  'agreement-request',
    'agreement.signed::Send signed agreement copy to client':                'agreement-signed',
    // The buyer's agent already has a class for "a report is ready" — the
    // agent-notification email sends it too (services/email/agent.ts). Same
    // notification, two paths, one switch.
    "report.published::Report Ready (Buyer's Agent)":                        'agent-report-ready',

    // Client-facing, the recipient's call (§2.2 / §2.3).
    'inspection.confirmed::24-Hour Reminder':            'inspection-reminder',
    'inspection.cancelled::Cancellation Notice':         'inspection-cancelled',
    'report.amended::Report Updated':                    'report-amended',
    'report.published::Report Ready (Listing Agent)':    'report-ready-listing-agent',
    "inspection.created::Booking Confirmation (Buyer's Agent)": 'booking-confirmation-buyers-agent',
    "report.amended::Report Updated (Buyer's Agent)":           'report-amended-buyers-agent',
    'event.created::Event Reminder (24h before)':        'event-reminder',
    'event.completed::Event Follow-up (results ready)':  'event-followup',
    'report.published::Post-inspection follow-up':       'post-inspection-followup',
    'report.published::Review request':                  'review-request',

    // Inspector work notifications (§2.5) — Operator's call, not the individual's.
    'payment.received::Payment Received':                                  'inspector-payment-received',
    'agreement.signed::Notify inspector when client signs agreement':      'inspector-agreement-signed',
    'agreement.declined::Notify inspector when client declines agreement': 'inspector-agreement-declined',
    'agreement.viewed::Notify inspector when client views agreement':      'inspector-agreement-viewed',

    // Office alerts — nine events, nine classes.
    'booking.received::Office alert — new booking':                  'office-alert-new-booking',
    'inspection.created::Office alert — inspection scheduled':       'office-alert-inspection-scheduled',
    'inspection.confirmed::Office alert — inspection confirmed':     'office-alert-inspection-confirmed',
    'inspection.cancelled::Office alert — inspection cancelled':     'office-alert-inspection-cancelled',
    'inspection.completed::Office alert — inspection completed':     'office-alert-inspection-completed',
    'report.published::Office alert — report published':             'office-alert-report-published',
    'invoice.created::Office alert — invoice created':               'office-alert-invoice-created',
    'payment.received::Office alert — payment received':             'office-alert-payment-received',
    'agreement.signed::Office alert — agreement signed':             'office-alert-agreement-signed',
};

/**
 * The class this rule sends, or `undefined` for a rule the tenant wrote.
 *
 * `undefined` reaches the boundary as an unclassified send: it still goes out,
 * it just cannot be muted (`isSuppressible` fails closed). That is the safe
 * direction — the alternative is silently withholding mail on a guess.
 */
export function automationClassId(
    rule: { name: string; trigger: string } | null | undefined,
): string | undefined {
    if (!rule) return undefined;
    return CLASS_BY_SEED[`${rule.trigger}::${rule.name}`];
}

/** Exposed for the drift gate in `tests/unit/notifications/`. */
export const SEED_CLASS_KEYS = Object.keys(CLASS_BY_SEED);
export const SEED_CLASS_IDS = Object.values(CLASS_BY_SEED);
