/**
 * <MessageThread> — THE chat thread, one component for every portal
 * (Cross-Portal Reuse rule: same entity in two portals ⇒ same component).
 *
 * Promoted from the client portal's MessagesSection body (design §3.3): it was
 * already a working chat surface on `ih-*` tokens, so this costs ~0 KiB against
 * a bundle at 96% of the Workers Free cap — where a chat dependency is
 * disqualified before its design-language clash is even considered.
 *
 * What the promotion added: day separators, consecutive-message grouping under
 * one author header, an optimistic pending state, scroll-to-latest, and the
 * attachment button (that upload endpoint had shipped with no caller).
 *
 * Deliberate shape:
 * - **Alignment carries direction** — outbound right, inbound left. No spine,
 *   no hairline: once alignment says who spoke, a rule is decoration.
 * - **The inspector view is a merge of threads, the client view is one
 *   thread.** Same row component, different data; inbound bubbles name the
 *   contact and their role because "who is this" is the merged view's first
 *   question. `showAuthorRole` turns those labels on.
 * - Presentational: data arrives via props, sends leave via `onSend`. The
 *   client portal fetches the public track directly; the inspector goes
 *   through a BFF resource route. This component cannot tell, and must not.
 */
import { useEffect, useRef, useState } from "react";
import { m } from "~/paraglide/messages";
import { useDisplayLocale, useDisplayTimeZone } from "~/hooks/useSessionContext";
import { bucketMessages, dayKeyInZone, dayLabel, type MessageRow } from "~/lib/communication-view";

export interface ThreadMessage extends MessageRow {
  /** Local-only: an optimistic send not yet confirmed, or one that failed. */
  pending?: boolean;
  failed?: boolean;
}

/**
 * `direction` here is VIEWER-relative: 'out' means the viewing side wrote it,
 * and renders right-aligned. The API payload's direction is inspector-relative
 * ('out' = staff wrote it), so the client portal flips it before passing —
 * that flip is the caller's job precisely so this component stays one
 * component across portals instead of growing a `viewer` switch.
 */

export interface MessageThreadProps {
  messages: ThreadMessage[];
  /** Builds the download URL for an attachment id. */
  attachmentHref: (attachmentId: string) => string;
  /** Resolves and posts the body; throw to surface the failure state. */
  onSend: (body: string) => Promise<void>;
  /** Optional file upload; omitted = no attach button (upload not wired). */
  onAttach?: (file: File) => Promise<void>;
  /** Label inbound bubbles with contact name + role (inspector merged view). */
  showAuthorRole?: boolean;
  /** Compose slot addition (e.g. the recipient chip); renders above the box. */
  composeExtra?: React.ReactNode;
  emptyTitle: string;
  emptyBody: string;
}

function roleLabel(fromRole: string): string {
  switch (fromRole) {
    case "client": return m.comm_role_client();
    case "agent":  return m.comm_role_agent();
    case "inspector": return m.comm_role_inspector();
    default: return m.comm_role_other();
  }
}

export function MessageThread({
  messages, attachmentHref, onSend, onAttach, showAuthorRole = false, composeExtra, emptyTitle, emptyBody,
}: MessageThreadProps) {
  const [composeBody, setComposeBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);
  const [uploading, setUploading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const timeZone = useDisplayTimeZone();
  const locale = useDisplayLocale();

  // Scroll-to-latest: newest sits at the bottom, so every content change pins
  // the viewport there — the reading position for a chat, not the top.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  async function handleSend() {
    const body = composeBody.trim();
    if (!body || sending) return;
    setSending(true);
    setSendFailed(false);
    try {
      await onSend(body);
      setComposeBody("");
    } catch {
      setSendFailed(true);
    } finally {
      setSending(false);
    }
  }

  async function handleAttachPick(file: File | undefined) {
    if (!file || !onAttach || uploading) return;
    setUploading(true);
    try {
      await onAttach(file);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const now = Date.now();
  const today = dayKeyInZone(now, timeZone);
  const yesterday = dayKeyInZone(now - 86_400_000, timeZone);
  const days = bucketMessages(messages, timeZone);

  return (
    <div>
      <div ref={listRef} className="space-y-4 max-h-[60vh] overflow-y-auto mb-4 pr-1">
        {days.map((day) => (
          <div key={day.dayKey}>
            {/* Day separator */}
            <div className="flex items-center gap-3 my-3" role="separator" aria-label={dayLabel(day.dayKey, today, yesterday, locale)}>
              <span className="flex-1 border-t border-ih-border" aria-hidden="true" />
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-ih-fg-4">
                {dayLabel(day.dayKey, today, yesterday, locale)}
              </span>
              <span className="flex-1 border-t border-ih-border" aria-hidden="true" />
            </div>

            {day.groups.map((group, gi) => {
              const first = group.messages[0];
              const outbound = first.direction === "out";
              return (
                <div key={`${day.dayKey}-${gi}`} className={`mb-3 ${outbound ? "ml-12" : "mr-12"}`}>
                  {/* One author header per consecutive run */}
                  <div className={`text-xs text-ih-fg-3 mb-1 ${outbound ? "text-right" : ""}`}>
                    {first.fromName || roleLabel(first.fromRole)}
                    {showAuthorRole && !outbound && (
                      <span className="text-ih-fg-4"> · {roleLabel(first.fromRole)}</span>
                    )}
                    <span className="text-ih-fg-4">
                      {" "}· {new Intl.DateTimeFormat(locale, { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(first.createdAt))}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {group.messages.map((msg) => (
                      <div
                        key={msg.id}
                        className={`rounded-md p-3 ${
                          outbound ? "bg-ih-primary-tint" : "bg-ih-bg-muted"
                        } ${msg.pending ? "opacity-60" : ""} ${msg.failed ? "border border-ih-bad" : ""}`}
                      >
                        <p className="text-sm whitespace-pre-wrap text-ih-fg-1">{msg.body}</p>
                        {msg.failed && (
                          <p className="text-[11px] text-ih-bad-fg mt-1">{m.comm_send_failed_inline()}</p>
                        )}
                        {msg.attachments && msg.attachments.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {msg.attachments.map((a) => (
                              <a
                                key={a.id}
                                href={attachmentHref(a.id)}
                                target="_blank"
                                rel="noreferrer"
                                className="text-xs bg-ih-bg-card border border-ih-border rounded-lg px-2 py-1 hover:bg-ih-bg-muted text-ih-fg-2"
                              >
                                {a.name}
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
        {messages.length === 0 && (
          <div className="text-center py-8">
            <h3 className="font-semibold text-ih-fg-3">{emptyTitle}</h3>
            <p className="text-sm text-ih-fg-3 mt-1">{emptyBody}</p>
          </div>
        )}
      </div>

      {/* Compose */}
      <div className="border-t border-ih-border pt-3">
        {composeExtra}
        <textarea
          value={composeBody}
          onChange={(e) => setComposeBody(e.target.value)}
          rows={3}
          placeholder={m.portal_messages_compose_placeholder()}
          className="w-full px-3 py-2 rounded-xl border border-ih-border text-sm resize-none bg-ih-bg-card text-ih-fg-1 outline-none focus:border-ih-primary"
        />
        {sendFailed && <p className="text-[12px] text-ih-bad-fg mt-1">{m.comm_send_failed()}</p>}
        <div className="mt-2 flex items-center justify-between gap-2">
          <div>
            {onAttach && (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  className="sr-only"
                  onChange={(e) => handleAttachPick(e.target.files?.[0])}
                  aria-label={m.comm_attach_file()}
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-ih-border bg-ih-bg-card text-[12px] font-semibold text-ih-fg-2 hover:text-ih-fg-1 disabled:opacity-50 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                    <path d="M13 7.5 8.3 12.2a3.2 3.2 0 0 1-4.5-4.5L8.9 2.6a2.1 2.1 0 0 1 3 3L7.2 10.3a1 1 0 0 1-1.5-1.5L10 4.6" />
                  </svg>
                  {uploading ? m.comm_attach_uploading() : m.comm_attach_file()}
                </button>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={handleSend}
            disabled={!composeBody.trim() || sending}
            className="px-4 py-2 rounded-xl bg-ih-primary text-ih-primary-fg text-sm font-semibold disabled:opacity-50 transition-opacity"
          >
            {sending ? m.portal_messages_send_pending() : m.portal_messages_send()}
          </button>
        </div>
      </div>
    </div>
  );
}
