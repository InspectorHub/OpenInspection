/**
 * <NoticeList> — what we sent you, and whether it arrived (design §3.11/§3.16).
 *
 * ONE component for the client portal and the agent portal, because after C1
 * they are one entity: a notice addressed to a recipient, delivered over one
 * or more channels. The audience difference is a prop, never a fork — the
 * agent's rows name the company (their inbox spans several) and their email
 * remedy is withheld (no composer exists there yet).
 *
 * The row's spine is the CHANNEL LINE: "Email — Delivered", "Text — Not
 * delivered". No other inbox tells the recipient how the message travelled,
 * and it is the whole reason this list exists rather than being a feed of
 * titles. So: every outcome is a WORD, present at all times; colour only
 * reinforces it; and a delivered row stays quiet — a status chip on a normal
 * row would make "it worked" look like an event.
 *
 * At most one remedy per row, and only where the path behind it is built.
 */
import { m } from "~/paraglide/messages";
import { EmptyState } from "@core/shared-ui";
import { formatRelativeTime } from "~/lib/format";
import { useDisplayLocale } from "~/hooks/useSessionContext";
import {
  channelLabel,
  channelOutcome,
  noticeReasonText,
  noticeRemedy,
  noticeTitle,
  type NoticeRowData,
  type NoticeRemedy,
} from "~/lib/notice-view";

function toneClass(tone: "quiet" | "watch" | "bad"): string {
  switch (tone) {
    case "bad":   return "text-ih-bad-fg";
    case "watch": return "text-ih-watch-fg";
    default:      return "text-ih-fg-3";
  }
}

export function NoticeList({
  notices,
  emailComposer,
  showCompany = false,
  emptyBody,
  onDismiss,
  onRemedy,
}: {
  notices: NoticeRowData[];
  /** Whether this portal has a message composer behind the email remedy. */
  emailComposer: boolean;
  /** The agent inbox spans companies, so each row says which one sent it. */
  showCompany?: boolean;
  emptyBody: string;
  onDismiss: (noticeId: string) => void;
  onRemedy: (remedy: NoticeRemedy) => void;
}) {
  const locale = useDisplayLocale();

  if (notices.length === 0) {
    return <EmptyState title={m.notice_empty_title()} description={emptyBody} />;
  }

  return (
    <ul className="divide-y divide-ih-border/60">
      {notices.map((n) => {
        const remedy = noticeRemedy(n, { emailComposer });
        const unread = n.readAt === null;
        return (
          <li key={n.id} className="px-3 py-2.5 flex gap-2.5">
            {/* Unread rail. `aria-label` rather than colour alone, and it holds
                its width when read so rows never shift as they are opened. */}
            <span className="w-1.5 shrink-0 pt-1.5">
              {unread && (
                <span
                  className="block w-1.5 h-1.5 rounded-full bg-ih-primary"
                  role="img"
                  aria-label={m.notice_unread_aria()}
                />
              )}
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex items-start gap-2">
                <p className={`min-w-0 flex-1 text-[13px] leading-snug ${unread ? "font-semibold text-ih-fg-1" : "text-ih-fg-2"}`}>
                  {noticeTitle(n)}
                </p>
                <button
                  type="button"
                  onClick={() => onDismiss(n.id)}
                  aria-label={m.notice_dismiss_aria()}
                  title={m.notice_dismiss()}
                  className="shrink-0 -mt-0.5 w-6 h-6 grid place-items-center rounded-md text-ih-fg-4 hover:text-ih-fg-2 hover:bg-ih-bg-muted transition-colors"
                >
                  <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                    <path d="M3 3l6 6M9 3l-6 6" />
                  </svg>
                </button>
              </div>

              {n.body && <p className="mt-0.5 text-[12px] text-ih-fg-3 leading-snug">{n.body}</p>}

              <p className="mt-0.5 text-[11px] text-ih-fg-3">
                {showCompany && n.companyName ? `${n.companyName} · ` : ""}
                {formatRelativeTime(n.createdAt, { locale })}
              </p>

              {/* The channel line — the spine of the row. */}
              {n.channels.length > 0 && (
                <ul className="mt-1.5 space-y-0.5">
                  {n.channels.map((ch, i) => {
                    const outcome = channelOutcome(ch);
                    const reason = noticeReasonText(ch);
                    return (
                      <li key={`${ch.channel}-${i}`} className="text-[11px]">
                        <span className="text-ih-fg-4">{channelLabel(ch.channel)}</span>
                        <span className="text-ih-fg-5"> — </span>
                        <span className={`font-semibold ${toneClass(outcome.tone)}`}>{outcome.label}</span>
                        {reason && <span className="block text-ih-fg-3 mt-0.5">{reason}</span>}
                      </li>
                    );
                  })}
                </ul>
              )}

              {remedy && (
                <button
                  type="button"
                  onClick={() => onRemedy(remedy)}
                  className="mt-2 inline-flex h-7 items-center px-2.5 rounded-lg border border-ih-border bg-ih-bg-card text-[11px] font-semibold text-ih-fg-2 hover:text-ih-fg-1 hover:bg-ih-bg-muted transition-colors"
                >
                  {remedy.kind === "sms-consent"
                    ? m.notice_action_turn_on_texts()
                    : m.notice_action_tell_new_email()}
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
