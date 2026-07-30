/**
 * Pure view logic for the Communication section (design §2/§3.3). No React, no
 * fetch — unit-testable shaping of the two payload arrays.
 */
import { m } from "~/paraglide/messages";

export interface DeliveryRow {
  id: string;
  channel: string;
  recipient: string;
  recipientContactId: string | null;
  roleKey: string | null;
  roleLabel: string | null;
  status: "pending" | "sent" | "failed" | "skipped";
  reasonCode: string | null;
  source: "automation" | "manual";
  /** Null for manual sends; the grouping key stringifies it, so a manual batch still groups on its shared sendAt. */
  automationId: string | null;
  automationName: string | null;
  /** C1 — the notice header this attempt belongs to. The REAL grouping key;
   *  null on legacy rows, which keep the interim (automationId, sendAt) key. */
  noticeId: string | null;
  sendAt: number;
  deliveredAt: number | null;
}

export interface MessageRow {
  id: string;
  direction: "in" | "out";
  contactId: string;
  fromRole: string;
  fromName: string | null;
  body: string;
  attachments: Array<{ id: string; key: string; name: string }>;
  createdAt: number;
}

/* ------------------------------------------------------------------ */
/*  Outbox — one row per NOTICE, not per log line                      */
/* ------------------------------------------------------------------ */

export interface NoticeChannel {
  channel: string;
  delivered: number;
  total: number;
  /** Worst state within this channel drives its colour. */
  tone: "ok" | "watch" | "bad" | "quiet";
}

export interface NoticeGroup {
  key: string;
  automationId: string | null;
  sendAt: number;
  channels: NoticeChannel[];
  recipients: DeliveryRow[];
  /** True when anything in the group skipped or failed. */
  needsAttention: boolean;
}

/**
 * Group log rows into notices. The REAL key is `notice_id` (C1, design §3.13):
 * one header per recipient x notice, so a stamped row groups with its
 * recipient's other channel attempts. Legacy rows (`notice_id` NULL — written
 * before C1, or a recipient that resolves to neither a user nor a contact)
 * fall back to the interim `(automation_id, send_at)` key: one firing computes
 * `sendAt` once outside both its loops, so every row it emits shares the
 * value. Do NOT group on `event_id`: it is set for `report.published` and
 * nothing else, deliberately, so every other trigger's rows carry NULL and
 * would collapse into one giant group. The `n:`/`f:` prefixes keep the two key
 * spaces disjoint — a stamped row must never join a fallback group.
 */
export function groupDeliveries(rows: DeliveryRow[]): NoticeGroup[] {
  const byKey = new Map<string, DeliveryRow[]>();
  for (const row of rows) {
    const key = row.noticeId ? `n:${row.noticeId}` : `f:${row.automationId}:${row.sendAt}`;
    const list = byKey.get(key) ?? [];
    list.push(row);
    byKey.set(key, list);
  }

  const groups: NoticeGroup[] = [];
  for (const [key, recipients] of byKey) {
    const byChannel = new Map<string, DeliveryRow[]>();
    for (const r of recipients) {
      const list = byChannel.get(r.channel) ?? [];
      list.push(r);
      byChannel.set(r.channel, list);
    }
    const channels: NoticeChannel[] = [...byChannel.entries()].map(([channel, list]) => {
      const delivered = list.filter((r) => r.status === "sent").length;
      const failed = list.some((r) => r.status === "failed");
      const skipped = list.some((r) => r.status === "skipped");
      return {
        channel,
        delivered,
        total: list.length,
        // Everything not delivered is what takes colour; a clean row stays quiet.
        tone: failed ? "bad" : skipped ? "watch" : delivered === list.length ? "quiet" : "ok",
      };
    });
    groups.push({
      key,
      automationId: recipients[0].automationId,
      sendAt: recipients[0].sendAt,
      channels,
      recipients,
      needsAttention: recipients.some((r) => r.status === "failed" || r.status === "skipped"),
    });
  }
  return groups.sort((a, b) => b.sendAt - a.sendAt);
}

/* ------------------------------------------------------------------ */
/*  Reason mapping — raw stored string → words                         */
/* ------------------------------------------------------------------ */

/**
 * The raw `error` strings the send paths write today, mapped to sentences.
 * The fallback keeps the RAW value visible inside a sentence — never render a
 * bare machine string, and never render nothing.
 */
export function reasonText(reasonCode: string | null): string | null {
  if (!reasonCode) return null;
  const norm = reasonCode.trim().toLowerCase();
  switch (norm) {
    case "no sms consent":          return m.comm_reason_no_sms_consent();
    // Distinct from the above on purpose: "opted out" is an instruction from
    // the recipient that the operator must not work around, while "never opted
    // in" is a gap they may legitimately close by asking.
    case "sms opt-out":             return m.comm_reason_sms_opt_out();
    case "review_url not configured": return m.comm_reason_no_review_url();
    case "sms not configured":      return m.comm_reason_sms_not_configured();
    case "email not configured":    return m.comm_reason_email_not_configured();
    case "no sms template":         return m.comm_reason_no_sms_template();
    case "no email template":       return m.comm_reason_no_email_template();
    case "managed_not_approved":    return m.comm_reason_managed_not_approved();
    default:                        return m.comm_reason_fallback({ raw: reasonCode });
  }
}

/* ------------------------------------------------------------------ */
/*  Messages — day separators + consecutive grouping                   */
/* ------------------------------------------------------------------ */

export interface MessageDay<T extends MessageRow = MessageRow> {
  /** Civil date key in the viewer's zone (YYYY-MM-DD). */
  dayKey: string;
  /** Runs of consecutive messages from the same author. */
  groups: Array<{ authorKey: string; messages: T[] }>;
}

/** The civil date an instant falls on in a zone. */
export function dayKeyInZone(epochMs: number, timeZone: string): string {
  try {
    // i18n-lint-ok: machine-readable parts, never displayed
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || "UTC",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date(epochMs));
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return new Date(epochMs).toISOString().slice(0, 10); // tz-lint-ok: unknown-zone fallback only
  }
}

/**
 * Bucket messages (assumed oldest-first) into days, then into runs of
 * consecutive messages from one author, so each run renders under a single
 * name header. The author key includes the contact for inbound rows because
 * the inspector view merges several threads — two contacts must never group
 * even if their display names collide.
 */
export function bucketMessages<T extends MessageRow>(messages: T[], timeZone: string): MessageDay<T>[] {
  const days: MessageDay<T>[] = [];
  for (const msg of messages) {
    const dayKey = dayKeyInZone(msg.createdAt, timeZone);
    let day = days[days.length - 1];
    if (!day || day.dayKey !== dayKey) {
      day = { dayKey, groups: [] };
      days.push(day);
    }
    const authorKey = msg.direction === "out" ? `staff:${msg.fromName ?? ""}` : `contact:${msg.contactId}`;
    let group = day.groups[day.groups.length - 1];
    if (!group || group.authorKey !== authorKey) {
      group = { authorKey, messages: [] };
      day.groups.push(group);
    }
    group.messages.push(msg);
  }
  return days;
}

/** `Today` / `Yesterday` / a localized date, for the day separator. */
export function dayLabel(dayKey: string, today: string, yesterday: string, locale: string): string {
  if (dayKey === today) return m.comm_day_today();
  if (dayKey === yesterday) return m.comm_day_yesterday();
  const [y, mo, d] = dayKey.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" })
    .format(new Date(Date.UTC(y, mo - 1, d, 12)));
}
