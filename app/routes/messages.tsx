/**
 * /messages — the company-wide Messages inbox (Track D, design §3.9).
 *
 * Threads are contact-keyed, so this page is `WHERE contact_id` over the same
 * table the inspector portal's Communication card reads — the Conversations
 * shape both Spectora and ISN ship. It is also the only surface that shows
 * messages with NO inspection attached (pre-booking outreach); the
 * per-inspection view filters those out by construction.
 *
 * Two panes on desktop: threads left, the selected conversation right (URL
 * carries `?contact=` so a thread deep-links and survives reload). The
 * conversation renders through the same <MessageThread> as everywhere else;
 * an inspection MENTION is the nullable inspection_id column with a value —
 * compose offers a chip, the bubble renders a link, and there is deliberately
 * no `@`-parser.
 */
import { useState } from "react";
import { Link, useFetcher, useLoaderData, useNavigate } from "react-router";
import type { Route } from "./+types/messages";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { PageHeader, Card, Avatar } from "@core/shared-ui";
import { MessageThread, type ThreadMessage } from "~/components/messaging/MessageThread";
import { useDisplayLocale, useDisplayTimeZone } from "~/hooks/useSessionContext";
import { m } from "~/paraglide/messages";

export function meta() {
  return [{ title: m.messages_meta_title() }];
}

interface ThreadSummary {
  contactId: string;
  contactName: string | null;
  contactEmail: string | null;
  lastBody: string;
  lastFromRole: string;
  lastAt: number;
  unread: number;
}

interface ThreadMessageRow {
  id: string;
  inspectionId: string | null;
  contactId: string;
  fromRole: string;
  fromName: string | null;
  body: string;
  attachments: Array<{ id: string; key: string; name: string }> | null;
  createdAt: number | string;
  propertyAddress: string | null;
}

interface ThreadData {
  contact: { contactId: string; name: string | null; email: string | null };
  messages: ThreadMessageRow[];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  const api = createApi(context, { token });
  const url = new URL(request.url);
  const selected = url.searchParams.get("contact");

  let threads: ThreadSummary[] = [];
  try {
    const res = await api.messages.threads.$get();
    if (res.ok) {
      const body = (await res.json()) as { data?: ThreadSummary[] };
      threads = body.data ?? [];
    }
  } catch { /* renders empty */ }

  let thread: ThreadData | null = null;
  if (selected) {
    try {
      const res = await api.messages.threads[":contactId"].$get({ param: { contactId: selected } });
      if (res.ok) {
        const body = (await res.json()) as { data?: ThreadData };
        thread = body.data ?? null;
      }
    } catch { /* pane shows nothing selected */ }
  }

  return { threads, thread, selected };
}

export async function action({ request, context }: Route.ActionArgs) {
  const token = await requireToken(context, request);
  const form = await request.formData();
  const contactId = String(form.get("contactId") ?? "");
  const body = String(form.get("body") ?? "").trim();
  const inspectionId = String(form.get("inspectionId") ?? "");
  if (!contactId || !body) return { ok: false as const };
  const api = createApi(context, { token });
  try {
    const res = await api.messages.threads[":contactId"].$post({
      param: { contactId },
      json: { body, ...(inspectionId ? { inspectionId } : {}) },
    });
    return { ok: res.ok };
  } catch {
    return { ok: false as const };
  }
}

function threadTime(ms: number, locale: string, timeZone: string): string {
  const d = new Date(ms);
  const now = Date.now();
  const sameDay = now - ms < 86_400_000 && d.getDate() === new Date(now).getDate();
  return new Intl.DateTimeFormat(locale, sameDay
    ? { timeZone, hour: "numeric", minute: "2-digit" }
    : { timeZone, month: "short", day: "numeric" }).format(d);
}

export default function MessagesPage() {
  const { threads, thread, selected } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const send = useFetcher<{ ok: boolean }>();
  const locale = useDisplayLocale();
  const timeZone = useDisplayTimeZone();
  const [mentionId, setMentionId] = useState("");

  // Mention options: the inspections already present in this thread. A brand-new
  // outreach thread has none, and that is correct — the mention exists to point
  // a conversation at work, not to invent it.
  const mentionOptions = thread
    ? [...new Map(
        thread.messages
          .filter((mrow) => mrow.inspectionId && mrow.propertyAddress)
          .map((mrow) => [mrow.inspectionId as string, mrow.propertyAddress as string]),
      ).entries()]
    : [];

  const threadMessages: ThreadMessage[] = (thread?.messages ?? []).map((mrow) => ({
    id: mrow.id,
    direction: mrow.fromRole === "inspector" ? "out" : "in",
    contactId: mrow.contactId,
    fromRole: mrow.fromRole,
    fromName: mrow.fromName,
    body: mrow.body,
    attachments: mrow.attachments ?? [],
    createdAt: typeof mrow.createdAt === "number" ? mrow.createdAt : new Date(mrow.createdAt).getTime(),
  }));

  async function handleSend(body: string) {
    if (!selected) throw new Error("no thread");
    send.submit(
      { contactId: selected, body, inspectionId: mentionId },
      { method: "post" },
    );
    // useFetcher-submitted actions auto-revalidate the loader, which refreshes
    // both the thread and the list's snippets.
  }

  return (
    <div className="space-y-ih-list">
      <PageHeader title={m.messages_heading()} meta={m.messages_meta({ count: threads.length })} />

      <div className="grid grid-cols-1 md:grid-cols-[minmax(240px,1fr)_2fr] gap-4 items-start">
        {/* ── Thread list ─────────────────────────────────────────────── */}
        <Card className="p-2">
          {threads.length === 0 ? (
            <p className="text-[13px] text-ih-fg-3 text-center py-10">{m.messages_empty_list()}</p>
          ) : (
            <ul className="divide-y divide-ih-border/60">
              {threads.map((t) => {
                const active = t.contactId === selected;
                return (
                  <li key={t.contactId}>
                    <button
                      type="button"
                      onClick={() => navigate(`/messages?contact=${encodeURIComponent(t.contactId)}`, { replace: !!selected })}
                      aria-current={active || undefined}
                      className={`w-full flex items-start gap-2.5 p-2.5 text-left rounded-md transition-colors ${
                        active ? "bg-ih-primary-tint" : "hover:bg-ih-bg-muted"
                      }`}
                    >
                      <Avatar name={t.contactName ?? t.contactEmail ?? "?"} size={28} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className={`text-[13px] truncate ${t.unread > 0 ? "font-bold text-ih-fg-1" : "font-medium text-ih-fg-2"}`}>
                            {t.contactName ?? t.contactEmail ?? m.messages_unknown_contact()}
                          </span>
                          <span className="text-[11px] text-ih-fg-4 tabular-nums shrink-0">{threadTime(t.lastAt, locale, timeZone)}</span>
                        </span>
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-[12px] text-ih-fg-3 truncate">{t.lastBody}</span>
                          {t.unread > 0 && (
                            <span className="inline-flex items-center h-4 min-w-4 justify-center px-1 rounded-full bg-ih-primary text-ih-primary-fg text-[10px] font-bold tabular-nums shrink-0">
                              {t.unread}
                            </span>
                          )}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* ── Conversation ────────────────────────────────────────────── */}
        <Card className="p-5">
          {!thread ? (
            <p className="text-[13px] text-ih-fg-3 text-center py-16">{m.messages_pick_thread()}</p>
          ) : (
            <>
              <div className="flex items-center gap-2.5 pb-3 mb-3 border-b border-ih-border">
                <Avatar name={thread.contact.name ?? thread.contact.email ?? "?"} size={28} />
                <div className="min-w-0">
                  <p className="text-[14px] font-bold text-ih-fg-1 truncate">{thread.contact.name ?? m.messages_unknown_contact()}</p>
                  {thread.contact.email && <p className="text-[12px] text-ih-fg-4 truncate">{thread.contact.email}</p>}
                </div>
              </div>

              {/* Inspection mentions render as quiet context lines above the
                  thread rather than per-bubble chrome: the thread interleaves
                  several inspections, and a link on EVERY bubble is noise. */}
              {mentionOptions.length > 0 && (
                <p className="text-[11px] text-ih-fg-4 mb-2">
                  {m.messages_thread_spans()}{" "}
                  {mentionOptions.map(([id, address], i) => (
                    <span key={id}>
                      {i > 0 && " · "}
                      <Link to={`/inspections/${id}`} className="text-ih-primary hover:underline">{address}</Link>
                    </span>
                  ))}
                </p>
              )}

              <MessageThread
                messages={threadMessages}
                showAuthorRole
                attachmentHref={(attId) => {
                  // Attachments belong to a per-inspection conversation; the
                  // download route is inspection-scoped. Resolve via the row.
                  const owner = thread.messages.find((mrow) => (mrow.attachments ?? []).some((a) => a.id === attId));
                  return owner?.inspectionId
                    ? `/api/inspections/${encodeURIComponent(owner.inspectionId)}/messages/attachments/${encodeURIComponent(attId)}`
                    : "#";
                }}
                onSend={handleSend}
                emptyTitle={m.messages_thread_empty_title()}
                emptyBody={m.messages_thread_empty_body()}
                composeExtra={
                  mentionOptions.length > 0 ? (
                    <div className="mb-2 flex items-center gap-2">
                      <span className="text-[11px] font-bold text-ih-fg-4 uppercase tracking-[0.1em]">{m.messages_mention_label()}</span>
                      <select
                        value={mentionId}
                        onChange={(e) => setMentionId(e.target.value)}
                        aria-label={m.messages_mention_aria()}
                        className="h-7 px-2 rounded-lg border border-ih-border bg-ih-bg-card text-[12px] text-ih-fg-1 outline-none focus:border-ih-primary"
                      >
                        <option value="">{m.messages_mention_none()}</option>
                        {mentionOptions.map(([id, address]) => (
                          <option key={id} value={id}>{address}</option>
                        ))}
                      </select>
                    </div>
                  ) : undefined
                }
              />
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
