import { useState, useEffect, useCallback } from "react";

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

export function MessagesSection({
  inspectionId,
  token,
}: {
  inspectionId: string;
  token?: string;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inspection, setInspection] = useState<InspectionInfo | null>(null);
  const [composeBody, setComposeBody] = useState("");
  const [sending, setSending] = useState(false);

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

  // Send message
  async function handleSend() {
    if (!composeBody.trim() || sending) return;
    setSending(true);
    try {
      const res = await fetch(`${base}${tokenQuery}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: composeBody }),
      });
      if (res.ok) {
        setComposeBody("");
        loadMessages();
      }
    } catch {
      /* silent */
    } finally {
      setSending(false);
    }
  }

  const ordered = messageRows(messages);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2 text-ih-fg-1">Messages</h1>
      {inspection && (
        <p className="text-sm text-ih-fg-3 mb-6">
          Inspection: {inspection.propertyAddress}
        </p>
      )}

      {/* Message list */}
      <div className="space-y-3 max-h-[60vh] overflow-y-auto mb-4">
        {ordered.map((m) => (
          <div
            key={m.id}
            className={`rounded-md p-3 ${
              m.fromRole === "client"
                ? "ml-12 bg-ih-primary-tint"
                : "mr-12 bg-ih-watch-bg"
            }`}
          >
            <div className="text-xs text-ih-fg-3 mb-1">
              {m.fromName || m.fromRole} &middot;{" "}
              {new Date(m.createdAt).toLocaleString()}
            </div>
            <p className="text-sm whitespace-pre-wrap text-ih-fg-1">{m.body}</p>
            {m.attachments && m.attachments.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {m.attachments.map((a) => (
                  <a
                    key={a.id}
                    href={`${base}/attachments/${encodeURIComponent(a.id)}${tokenQuery}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs bg-ih-bg-card border border-ih-border rounded-lg px-2 py-1 hover:bg-ih-bg-muted"
                  >
                    {a.name}
                  </a>
                ))}
              </div>
            )}
          </div>
        ))}
        {ordered.length === 0 && (
          <div className="text-center py-8">
            <h3 className="font-semibold text-ih-fg-3">No messages yet</h3>
            <p className="text-sm text-ih-fg-3 mt-1">Send the first one below.</p>
          </div>
        )}
      </div>

      {/* Compose */}
      <div className="border-t border-ih-border pt-3 bg-ih-bg-card p-4 rounded-md">
        <textarea
          value={composeBody}
          onChange={(e) => setComposeBody(e.target.value)}
          rows={3}
          placeholder="Type your message..."
          className="w-full px-3 py-2 rounded-xl border border-ih-border text-sm resize-none bg-ih-bg-card text-ih-fg-1 outline-none focus:border-ih-primary"
        />
        <div className="mt-2 flex items-center justify-end">
          <button
            type="button"
            onClick={handleSend}
            disabled={!composeBody.trim() || sending}
            className="px-4 py-2 rounded-xl bg-ih-primary text-ih-primary-fg text-sm font-semibold disabled:opacity-50 transition-opacity"
          >
            {sending ? "Sending..." : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
