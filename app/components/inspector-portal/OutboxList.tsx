/**
 * <OutboxList> — the record of what the platform sent (design §3.3).
 *
 * One row = one NOTICE. Since C1 (design §3.13) the key is `notice_id` — one
 * header per recipient x notice, so a stamped publish to four people over two
 * channels is four rows with the channels folded inside each; legacy rows
 * without a header keep the interim `(automation_id, send_at)` key and fold
 * per firing. The grouping itself lives in `groupDeliveries`
 * (app/lib/communication-view.ts).
 *
 * The row's signature is per-channel delivered/total counts. An icon never
 * carries state alone: every count is text beside the icon plus a
 * visually-hidden sentence, and colour is never the only signal. Everything
 * not delivered is what takes colour; a clean row stays quiet.
 *
 * The channel cell renders whatever `channel` arrives — no `email|sms`
 * switch. That is the zero-cost concession that keeps a future `in_app`
 * channel a drop-in instead of a rewrite.
 */
import { useState } from "react";
import { m } from "~/paraglide/messages";
import { useDisplayLocale, useDisplayTimeZone } from "~/hooks/useSessionContext";
import { reasonText, type NoticeGroup, type NoticeChannel, type DeliveryRow } from "~/lib/communication-view";

function channelIcon(channel: string) {
  // Known channels get a glyph; anything else gets a neutral dot. The LABEL
  // always renders as text, so an unknown channel is ugly, never invisible.
  if (channel === "email") {
    return (
      <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <rect x="1.5" y="3" width="13" height="10" rx="1.5" /><path d="m2 4.5 6 4.5 6-4.5" />
      </svg>
    );
  }
  if (channel === "sms") {
    return (
      <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <path d="M14 10a1.5 1.5 0 0 1-1.5 1.5H5L2 14V3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5z" />
      </svg>
    );
  }
  return <span className="w-2 h-2 rounded-full bg-current inline-block" aria-hidden="true" />;
}

function toneClass(tone: NoticeChannel["tone"]): string {
  switch (tone) {
    case "bad":   return "text-ih-bad-fg";
    case "watch": return "text-ih-watch-fg";
    default:      return "text-ih-fg-3";
  }
}

const STATUS_LABEL: Record<string, () => string> = {
  sent:    () => m.comm_status_sent(),
  failed:  () => m.comm_status_failed(),
  skipped: () => m.comm_status_skipped(),
  pending: () => m.comm_status_pending(),
};

export function OutboxList({
  groups,
  onGetConsent,
  onResend,
}: {
  groups: NoticeGroup[];
  /** Scrolls to / opens the SMS-consent control on the People card. */
  onGetConsent?: () => void;
  /** Re-issues a FAILED manual send to that one recipient (A2.2). Automation
   *  rows never offer it — re-firing a rule is the Automations page's job. */
  onResend?: (row: DeliveryRow) => void;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const timeZone = useDisplayTimeZone();
  const locale = useDisplayLocale();

  const when = (ms: number) =>
    new Intl.DateTimeFormat(locale, { timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
      .format(new Date(ms));

  return (
    <ul className="divide-y divide-ih-border/60">
      {groups.map((g) => {
        const open = openKey === g.key;
        return (
          <li key={g.key}>
            <button
              type="button"
              onClick={() => setOpenKey(open ? null : g.key)}
              aria-expanded={open}
              className="w-full flex items-center gap-3 py-2.5 text-left hover:bg-ih-bg-muted/50 rounded-md px-1.5 transition-colors"
            >
              <span className="flex items-center gap-3 shrink-0">
                {g.channels.map((ch) => (
                  <span key={ch.channel} className={`inline-flex items-center gap-1 text-[12px] font-semibold tabular-nums ${toneClass(ch.tone)}`}>
                    {channelIcon(ch.channel)}
                    <span aria-hidden="true">{ch.delivered}/{ch.total}</span>
                    <span className="sr-only">
                      {m.comm_channel_delivered_sr({ delivered: ch.delivered, total: ch.total, channel: ch.channel })}
                    </span>
                  </span>
                ))}
              </span>
              <span className="flex-1 min-w-0 text-[13px] text-ih-fg-1 truncate">
                {g.recipients[0]?.automationName
                  ?? (g.recipients[0]?.source === "manual" ? m.comm_notice_manual() : m.comm_notice_automation())}
              </span>
              <span className="text-[12px] text-ih-fg-4 tabular-nums shrink-0">{when(g.sendAt)}</span>
              <svg className={`w-3 h-3 shrink-0 text-ih-fg-4 transition-transform ${open ? "rotate-180" : ""}`} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="M3 4.5 6 7.5 9 4.5" />
              </svg>
            </button>

            {open && (
              <ul className="pb-2.5 pl-2 pr-1.5 space-y-1.5">
                {g.recipients.map((r) => {
                  const reason = r.status === "skipped" || r.status === "failed" ? reasonText(r.reasonCode) : null;
                  const consentRemedy = (r.reasonCode ?? "").trim().toLowerCase() === "no sms consent";
                  return (
                    <li key={r.id} className="flex items-start gap-2 text-[12px]">
                      <span className={`shrink-0 mt-0.5 ${toneClass(r.status === "failed" ? "bad" : r.status === "skipped" ? "watch" : "quiet")}`}>
                        {channelIcon(r.channel)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="text-ih-fg-2 font-medium">
                          {r.roleLabel ?? r.roleKey ?? m.comm_recipient_norole()}
                        </span>
                        <span className="text-ih-fg-4"> · {r.recipient}</span>
                        <span className={`ml-1.5 ${toneClass(r.status === "failed" ? "bad" : r.status === "skipped" ? "watch" : "quiet")}`}>
                          {(STATUS_LABEL[r.status] ?? (() => r.status))()}
                        </span>
                        {reason && <span className="block text-ih-fg-3 mt-0.5">{reason}</span>}
                        {consentRemedy && onGetConsent && (
                          <button
                            type="button"
                            onClick={onGetConsent}
                            className="mt-1 inline-flex h-7 items-center px-2.5 rounded-lg border border-ih-border bg-ih-bg-card text-[11px] font-semibold text-ih-fg-2 hover:text-ih-fg-1 transition-colors"
                          >
                            {m.comm_action_get_consent()}
                          </button>
                        )}
                        {/* Channel-faithful by design: a resend goes through the
                            SAME provider the row failed on. Email → send-report;
                            SMS → send-sms (A3). Never cross channels. */}
                        {onResend && r.source === "manual" && r.status === "failed" && r.roleKey && (r.channel === "email" || r.channel === "sms") && (
                          <button
                            type="button"
                            onClick={() => onResend(r)}
                            className="mt-1 ml-1.5 inline-flex h-7 items-center px-2.5 rounded-lg border border-ih-border bg-ih-bg-card text-[11px] font-semibold text-ih-fg-2 hover:text-ih-fg-1 transition-colors"
                          >
                            {m.comm_action_resend()}
                          </button>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}
