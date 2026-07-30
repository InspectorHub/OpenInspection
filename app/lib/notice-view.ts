/**
 * Recipient-facing Notice view logic (design §3.16). Pure — no React, no fetch.
 *
 * This is deliberately NOT `communication-view.ts`. That file is written for
 * an operator: it maps every raw reason to an operator sentence and keeps the
 * unmapped value visible. Both are correct for their reader, and a single map
 * with an audience flag is the shape that drifts — so the customer-facing list
 * is enumerated here, separately and much shorter.
 *
 * Two editorial rules, both of which the tests pin:
 *
 * 1. Only reasons that are ABOUT the recipient and ACTIONABLE BY THEM get
 *    words. "The rule has no template", "SMS isn't set up", "the number is
 *    awaiting carrier approval" are OUR problems; a customer reading them
 *    learns nothing they can act on and opens a support ticket. Everything
 *    unrecognized becomes a flat "Not delivered" — no detail, no button.
 * 2. A remedy renders only where the path behind it exists. "Turn on texts"
 *    is a real endpoint everywhere. The email remedy opens a message composer,
 *    so it renders only where there IS one. (There is deliberately no
 *    self-service email change: portal access is keyed on the address, so
 *    letting the current link-holder repoint it is an account-takeover shape.)
 */
import { m } from "~/paraglide/messages";

export interface NoticeChannelAttempt {
  channel: string;
  status: "pending" | "sent" | "failed" | "skipped";
  /** RAW stored reason — never rendered to a recipient; mapped or dropped. */
  reasonCode: string | null;
  /** The reader's OWN address for this channel. The header is per-recipient,
   *  so this is never someone else's. */
  recipient: string;
  deliveredAt: number | null;
  sendAt: number;
}

export interface NoticeRowData {
  id: string;
  tenantId: string;
  type: string;
  title: string;
  body: string | null;
  inspectionId: string | null;
  createdAt: number;
  readAt: number | null;
  channels: NoticeChannelAttempt[];
  /** Company that sent it. Set only on the agent inbox, which spans companies. */
  companyName?: string | null;
}

export type NoticeRemedy =
  | { kind: "sms-consent"; noticeId: string }
  | { kind: "email"; noticeId: string; address: string };

/** The one skip reason a recipient can actually clear themselves. */
const SMS_CONSENT = "no sms consent";

/**
 * A delivery failure that means THE ADDRESS is wrong, enumerated rather than
 * inferred. Any other failure (a provider outage, a reset connection) is ours,
 * and telling someone their address is wrong because our sender hiccuped is
 * worse than saying nothing.
 */
const ADDRESS_REJECTED = /(bounce|bounced|rejected|invalid recipient|mailbox|no such user|does not exist|user unknown|unknown user|55[0-3])/i;

export interface ChannelOutcome {
  /** What happened, in words. Always present — colour is never the only signal. */
  label: string;
  tone: "quiet" | "watch" | "bad";
}

export function channelOutcome(attempt: NoticeChannelAttempt): ChannelOutcome {
  switch (attempt.status) {
    case "sent":    return { label: m.notice_outcome_delivered(), tone: "quiet" };
    case "pending": return { label: m.notice_outcome_sending(), tone: "quiet" };
    case "failed":  return { label: m.notice_outcome_not_delivered(), tone: "bad" };
    default:        return { label: m.notice_outcome_not_delivered(), tone: "watch" };
  }
}

/**
 * The title a RECIPIENT sees.
 *
 * The stored title is written for staff — `titleFor()` in the trigger path and
 * the manual-send default both say things like "Manual send" and "Report
 * ready", which is an operator's shorthand appearing in a customer's inbox.
 * Mapping the notice TYPE here is the honest minimum: the reader gets a
 * sentence about their own inspection, and an unrecognized type falls back to
 * the stored title rather than to nothing.
 *
 * This is not the real fix. Those titles are twelve hardcoded English literals
 * (IA-115) that no locale can reach; Track B moves them onto message
 * templates, and this map retires when it does.
 */
export function noticeTitle(row: NoticeRowData): string {
  switch (row.type) {
    case "report.published":     return m.notice_title_report_published();
    case "report.amended":       return m.notice_title_report_amended();
    case "invoice.created":      return m.notice_title_invoice_created();
    case "payment.received":     return m.notice_title_payment_received();
    case "inspection.confirmed": return m.notice_title_inspection_confirmed();
    case "inspection.reminder":  return m.notice_title_inspection_reminder();
    case "agreement.signed":     return m.notice_title_agreement_signed();
    case "manual.send":          return m.notice_title_manual_send();
    default:                     return row.title;
  }
}

/** Channel name in the reader's words — never the stored token. */
export function channelLabel(channel: string): string {
  if (channel === "email") return m.notice_channel_email();
  if (channel === "sms") return m.notice_channel_sms();
  return m.notice_channel_other();
}

/**
 * The sentence under a channel line, or null when there is nothing a recipient
 * can be told. Only the two recipient-facing cases have copy.
 */
export function noticeReasonText(attempt: NoticeChannelAttempt): string | null {
  const raw = (attempt.reasonCode ?? "").trim().toLowerCase();
  if (attempt.channel === "sms" && raw === SMS_CONSENT) return m.notice_reason_no_sms_consent();
  if (attempt.channel === "email" && attempt.status === "failed" && ADDRESS_REJECTED.test(raw)) {
    return m.notice_reason_bounced({ address: attempt.recipient });
  }
  return null;
}

/**
 * At most ONE remedy per notice. Consent outranks a bounce: it is the cheaper
 * fix, it is fully self-service, and stacking two calls to action on one row
 * makes neither look required.
 */
export function noticeRemedy(
  row: NoticeRowData,
  opts: { emailComposer: boolean },
): NoticeRemedy | null {
  const smsSkipped = row.channels.find(
    (c) => c.channel === "sms"
      && (c.status === "skipped" || c.status === "failed")
      && (c.reasonCode ?? "").trim().toLowerCase() === SMS_CONSENT,
  );
  if (smsSkipped) return { kind: "sms-consent", noticeId: row.id };

  if (!opts.emailComposer) return null;
  const bounced = row.channels.find(
    (c) => c.channel === "email" && c.status === "failed" && ADDRESS_REJECTED.test(c.reasonCode ?? ""),
  );
  if (bounced) return { kind: "email", noticeId: row.id, address: bounced.recipient };
  return null;
}

