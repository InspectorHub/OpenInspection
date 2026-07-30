import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router";
import { m } from "~/paraglide/messages";
import { MessageThread, type ThreadMessage } from "~/components/messaging/MessageThread";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface Message {
  id: string;
  body: string;
  fromRole: string;
  fromName: string | null;
  createdAt: string | number;
  attachments: Array<{ id: string; key: string; name: string }>;
}

interface InspectionInfo {
  propertyAddress: string;
}

/* ------------------------------------------------------------------ */
/*  Pure helper                                                        */
/* ------------------------------------------------------------------ */

/**
 * Sorts messages oldest → newest by `createdAt`. Handles both numeric
 * (epoch ms) and ISO string timestamps. Pure — keeps all fields, does not
 * mutate the input. Unit-testable.
 */
export function messageRows<
  T extends { createdAt: string | number },
>(msgs: T[]): T[] {
  const toMs = (v: string | number): number =>
    typeof v === "number" ? v : new Date(v).getTime();
  return [...msgs].sort((a, b) => toMs(a.createdAt) - toMs(b.createdAt));
}

/* ------------------------------------------------------------------ */
/*  Section (bare content — no page chrome)                            */
/* ------------------------------------------------------------------ */

/**
 * The client portal's Messages tab. Data/transport layer only: the thread
 * rendering itself is <MessageThread>, the ONE chat component every portal
 * shares (Cross-Portal Reuse). This wrapper owns the public-track fetches
 * (portal session cookie / ?token) and flips the payload's inspector-relative
 * direction to viewer-relative before handing rows down.
 */
export function MessagesSection({
  inspectionId,
  token,
}: {
  inspectionId: string;
  token?: string;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inspection, setInspection] = useState<InspectionInfo | null>(null);
  // The Notices email remedy deep-links here with ?prefill=email — the remedy
  // is a message, not a form (design §3.16), so the composer opens with the
  // first line already written.
  const [searchParams] = useSearchParams();
  const prefill = searchParams.get("prefill");

  // Same-origin: the __Host-portal_session cookie is sent automatically. The
  // per-inspection portal ?token is a fallback (email-CTA arrival), appended
  // only when present — mirrors DocumentsSection / portal-inspection.
  const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : "";
  const base = `/api/public/inspections/${encodeURIComponent(inspectionId)}/messages`;

  // Load messages
  const loadMessages = useCallback(async () => {
    try {
      const res = await fetch(`${base}${tokenQuery}`);
      const json = (await res.json()) as Record<string, unknown>;
      if (json.success) {
        // The endpoint returns the messages array directly under `data`;
        // tolerate the legacy `{ messages, inspection }` envelope too.
        const data = json.data as
          | Message[]
          | { messages?: Message[]; inspection?: InspectionInfo };
        if (Array.isArray(data)) {
          setMessages(data);
        } else {
          setMessages(data.messages ?? []);
          if (data.inspection) setInspection(data.inspection);
        }
      }
    } catch {
      /* silent */
    }
  }, [base, tokenQuery]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  async function handleSend(body: string) {
    const res = await fetch(`${base}${tokenQuery}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    if (!res.ok) throw new Error("send failed");
    await loadMessages();
  }

  // Attach: upload first, then send a bodied message carrying the descriptor.
  async function handleAttach(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    const up = await fetch(`${base}/upload${tokenQuery}`, { method: "POST", body: fd });
    if (!up.ok) throw new Error("upload failed");
    const json = (await up.json()) as { data?: { id: string; key: string; name: string; size: number; type: string; uploadedAt: number } };
    if (!json.data) throw new Error("upload failed");
    const res = await fetch(`${base}${tokenQuery}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: json.data.name, attachments: [json.data] }),
    });
    if (!res.ok) throw new Error("send failed");
    await loadMessages();
  }

  // Viewer-relative direction: in the CLIENT's view, their own side is
  // everything not inspector-authored.
  const threadMessages: ThreadMessage[] = messageRows(messages).map((msg) => ({
    id: msg.id,
    direction: msg.fromRole === "inspector" ? "in" : "out",
    contactId: "self",
    fromRole: msg.fromRole,
    fromName: msg.fromName,
    body: msg.body,
    attachments: msg.attachments ?? [],
    createdAt: typeof msg.createdAt === "number" ? msg.createdAt : new Date(msg.createdAt).getTime(),
  }));

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2 text-ih-fg-1">{m.portal_hub_nav_messages()}</h1>
      {inspection && (
        <p className="text-sm text-ih-fg-3 mb-6">
          {m.portal_messages_inspection_label({ address: inspection.propertyAddress })}
        </p>
      )}
      <MessageThread
        messages={threadMessages}
        initialDraft={prefill === "email" ? m.notice_draft_new_email() : ""}
        attachmentHref={(attId) => `${base}/attachments/${encodeURIComponent(attId)}${tokenQuery}`}
        onSend={handleSend}
        onAttach={handleAttach}
        emptyTitle={m.portal_messages_empty_title()}
        emptyBody={m.portal_messages_empty_body()}
      />
    </div>
  );
}
