/**
 * <CommunicationSection> — the hub card answering "what has been said, and
 * what did we send" (Communication design §2/§3.3, plan A1.3).
 *
 * TWO blocks with two deliberately different grammars, never interleaved:
 * **Messages** (people talking — a chat thread) above, **Outbox** (the record
 * of what the platform sent) below. The contrast IS the information; the
 * earlier merged draft read as one undifferentiated list.
 *
 * Loading: the card renders its summary line from the hub aggregate's counts
 * (zero extra round trips); both block bodies load on expand via useFetcher,
 * mirroring EntityAuditTrail. The deferral is about loader latency — the hub
 * loader already makes five sequential round trips — NOT bundle size: per
 * IA-91 a lazily-fetched chunk still counts toward the Worker upload, so
 * deferring buys nothing there.
 *
 * Outbox auto-expands when needsAttention > 0 — a failure must never hide
 * behind a disclosure.
 *
 * Polling (design §3.14): one payload reload every 45s while the tab is
 * visible, stopped on visibilitychange, plus an immediate revalidate after a
 * send. Every poll is a Worker request and a D1 read and Workers Free meters
 * both — a background tab must cost nothing.
 */
import { useCallback, useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { Card } from "@core/shared-ui";
import { m } from "~/paraglide/messages";
import { BlockHeading } from "./BlockHeading";
import { OutboxList } from "./OutboxList";
import { MessageThread, type ThreadMessage } from "~/components/messaging/MessageThread";
import { groupDeliveries, type DeliveryRow } from "~/lib/communication-view";
import type { CommunicationPayload } from "~/routes/resources/inspection-communication";

export interface CommunicationCounts {
    delivered: number;
    needsAttention: number;
    unread: number;
    rulesActive: number;
}

export interface ThreadOption {
    contactId: string;
    name: string;
    roleLabel: string | null;
}

const RESOURCE = "/resources/inspection-communication";
const POLL_MS = 45_000;

export function CommunicationSection({
    inspectionId,
    counts,
    reportPublished,
    threadOptions,
    onGetConsent,
}: {
    inspectionId: string;
    counts: CommunicationCounts;
    /** Distinguishes the three Outbox empty states — they look identical and mean opposites. */
    reportPublished: boolean;
    /** People on this inspection an inspector may message (compose picker). */
    threadOptions: ThreadOption[];
    onGetConsent?: () => void;
}) {
    const [messagesOpen, setMessagesOpen] = useState(false);
    // A failure must never hide behind a disclosure.
    const [outboxOpen, setOutboxOpen] = useState(counts.needsAttention > 0);
    const payload = useFetcher<CommunicationPayload>();
    const send = useFetcher<{ ok: boolean }>();
    // Resend posts to the PAGE action's send-report intent (BFF — the browser
    // never calls /api directly), so a failed manual row re-sends to exactly
    // that one recipient with the role it was originally addressed under.
    const resend = useFetcher<{ ok: boolean }>();
    const [recipientId, setRecipientId] = useState<string>("");
    // Optimistic bubbles: rendered immediately, dropped once the reload lands.
    const [pendingSends, setPendingSends] = useState<ThreadMessage[]>([]);

    const loaded = payload.data != null;
    // Opening the merged Messages view marks the whole inspection read — every
    // thread is visible at once there, so per-inspection is honest. A poll with
    // the block closed must NOT clear anything, hence the flag.
    const messagesOpenRef = messagesOpen;
    const load = useCallback(() => {
        const markRead = messagesOpenRef ? "&markRead=1" : "";
        payload.load(`${RESOURCE}?inspectionId=${encodeURIComponent(inspectionId)}${markRead}`);
        // payload is a stable fetcher instance; depending on it re-arms the poll every render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [inspectionId, messagesOpenRef]);

    const anyOpen = messagesOpen || outboxOpen;

    // First open loads; the poll keeps whatever is open fresh while the tab is
    // visible. Cleared the moment both blocks close or the tab hides.
    useEffect(() => {
        if (!anyOpen) return;
        if (!loaded) load();
        let timer: ReturnType<typeof setInterval> | null = null;
        const start = () => { if (!timer) timer = setInterval(load, POLL_MS); };
        const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
        const onVisibility = () => (document.hidden ? stop() : start());
        start();
        document.addEventListener("visibilitychange", onVisibility);
        return () => { stop(); document.removeEventListener("visibilitychange", onVisibility); };
    }, [anyOpen, loaded, load]);

    // A completed send: drop the optimistic bubbles and pull the real rows.
    const sendState = send.state;
    useEffect(() => {
        if (sendState === "idle" && send.data) {
            setPendingSends([]);
            load();
        }

    }, [sendState, send.data, load]);

    // A completed resend: refresh so the new ledger row replaces the failed one's story.
    const resendState = resend.state;
    useEffect(() => {
        if (resendState === "idle" && resend.data) load();
    }, [resendState, resend.data, load]);

    function handleResend(row: DeliveryRow) {
        // Channel-faithful: the resend rides the row's OWN channel so it reaches
        // the same provider that failed. The send-report endpoint accepts email
        // today; when A3's manual-SMS endpoint lands, SMS rows route there —
        // never through the email path as a fallback.
        if (!row.roleKey || row.channel !== "email") return;
        const recipient = row.recipientContactId
            ? { contactId: row.recipientContactId, roleKey: row.roleKey }
            : { email: row.recipient, roleKey: row.roleKey };
        resend.submit(
            { intent: "send-report", recipients: JSON.stringify([recipient]), channels: JSON.stringify([row.channel]) },
            { method: "post" },
        );
    }

    const messages = payload.data?.messages ?? [];
    const deliveries = payload.data?.deliveries ?? [];
    const groups = groupDeliveries(deliveries);

    // Compose default: the most recent inbound message's contact, else the
    // first person on the inspection.
    const lastInbound = [...messages].reverse().find((mrow) => mrow.direction === "in");
    const effectiveRecipient = recipientId || lastInbound?.contactId || threadOptions[0]?.contactId || "";

    async function handleSend(body: string) {
        if (!effectiveRecipient) throw new Error("no recipient");
        setPendingSends((prev) => [...prev, {
            id: `pending-${Date.now()}`,
            direction: "out",
            contactId: effectiveRecipient,
            fromRole: "inspector",
            fromName: null,
            body,
            attachments: [],
            createdAt: Date.now(),
            pending: true,
        }]);
        send.submit(
            { inspectionId, body, contactId: effectiveRecipient },
            { method: "post", action: RESOURCE },
        );
    }

    const summary = m.comm_summary_line({
        delivered: counts.delivered,
        unread: counts.unread,
        attention: counts.needsAttention,
    });

    const outboxEmpty = counts.rulesActive === 0
        ? m.comm_outbox_empty_no_rules()
        : !reportPublished
            ? m.comm_outbox_empty_unpublished()
            : m.comm_outbox_empty_nothing_yet();

    return (
        <Card className="p-5">
            <BlockHeading
                title={m.comm_block_title()}
                pill={counts.needsAttention > 0 ? { tone: "warning", label: m.comm_pill_attention({ count: counts.needsAttention }) } : undefined}
            />
            <p className="text-[12px] text-ih-fg-3 mb-3">{summary}</p>

            {/* ── Messages — people talking ─────────────────────────────── */}
            <button
                type="button"
                onClick={() => setMessagesOpen((v) => !v)}
                aria-expanded={messagesOpen}
                className="w-full flex items-center justify-between gap-2 py-2 text-left"
            >
                <span className="text-[12px] font-extrabold uppercase tracking-[0.12em] text-ih-fg-3">
                    {m.comm_messages_heading()}
                    {counts.unread > 0 && (
                        <span className="ml-2 inline-flex items-center h-4 px-1.5 rounded-full bg-ih-primary text-ih-primary-fg text-[10px] tabular-nums align-middle">
                            {counts.unread}
                        </span>
                    )}
                </span>
                <svg className={`w-3 h-3 text-ih-fg-4 transition-transform ${messagesOpen ? "rotate-180" : ""}`} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                    <path d="M3 4.5 6 7.5 9 4.5" />
                </svg>
            </button>
            {messagesOpen && (
                <div className="pb-3">
                    {payload.state === "loading" && !loaded ? (
                        <p className="text-[12px] text-ih-fg-4 py-4 text-center">{m.comm_loading()}</p>
                    ) : (
                        <MessageThread
                            messages={[...messages, ...pendingSends]}
                            showAuthorRole
                            attachmentHref={(attId) => `/api/inspections/${encodeURIComponent(inspectionId)}/messages/attachments/${encodeURIComponent(attId)}`}
                            onSend={handleSend}
                            emptyTitle={m.comm_messages_empty_title()}
                            emptyBody={m.comm_messages_empty_body()}
                            composeExtra={threadOptions.length > 0 ? (
                                <div className="mb-2 flex items-center gap-2">
                                    <span className="text-[11px] font-bold text-ih-fg-4 uppercase tracking-[0.1em]">{m.comm_compose_to()}</span>
                                    <select
                                        value={effectiveRecipient}
                                        onChange={(e) => setRecipientId(e.target.value)}
                                        aria-label={m.comm_compose_to_aria()}
                                        className="h-7 px-2 rounded-lg border border-ih-border bg-ih-bg-card text-[12px] text-ih-fg-1 outline-none focus:border-ih-primary"
                                    >
                                        {threadOptions.map((o) => (
                                            <option key={o.contactId} value={o.contactId}>
                                                {o.roleLabel ? `${o.name} — ${o.roleLabel}` : o.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            ) : undefined}
                        />
                    )}
                </div>
            )}

            {/* ── Outbox — the record of what the platform sent ─────────── */}
            <div className="border-t border-ih-border">
                <button
                    type="button"
                    onClick={() => setOutboxOpen((v) => !v)}
                    aria-expanded={outboxOpen}
                    className="w-full flex items-center justify-between gap-2 py-2 text-left"
                >
                    <span className="text-[12px] font-extrabold uppercase tracking-[0.12em] text-ih-fg-3">
                        {m.comm_outbox_heading()}
                    </span>
                    <svg className={`w-3 h-3 text-ih-fg-4 transition-transform ${outboxOpen ? "rotate-180" : ""}`} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                        <path d="M3 4.5 6 7.5 9 4.5" />
                    </svg>
                </button>
                {outboxOpen && (
                    payload.state === "loading" && !loaded ? (
                        <p className="text-[12px] text-ih-fg-4 py-4 text-center">{m.comm_loading()}</p>
                    ) : groups.length > 0 ? (
                        <OutboxList groups={groups} onGetConsent={onGetConsent} onResend={handleResend} />
                    ) : (
                        <p className="text-[12px] text-ih-fg-4 py-4 text-center">{outboxEmpty}</p>
                    )
                )}
            </div>
        </Card>
    );
}
