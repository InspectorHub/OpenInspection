import { useState, useEffect, useCallback } from "react";
import { useLoaderData } from "react-router";
import type { Route } from "./+types/messages";

export function meta() {
  return [{ title: "Messages - OpenInspection" }];
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Message {
  id: string;
  body: string;
  fromRole: string;
  fromName: string | null;
  createdAt: string;
  attachments: Array<{ id: string; key: string; name: string }>;
}

interface InspectionInfo {
  propertyAddress: string;
}

/* ------------------------------------------------------------------ */
/*  Loader                                                             */
/* ------------------------------------------------------------------ */

export async function loader({ params }: Route.LoaderArgs) {
  return { token: params.token ?? "" };
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function MessagesPublicPage() {
  const { token } = useLoaderData<typeof loader>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inspection, setInspection] = useState<InspectionInfo | null>(null);
  const [composeBody, setComposeBody] = useState("");
  const [sending, setSending] = useState(false);

  // Load messages
  const loadMessages = useCallback(async () => {
    try {
      const res = await fetch(`/api/public/messages/${token}`);
      const json = (await res.json()) as Record<string, unknown>;
      if (json.success) {
        const data = json.data as {
          messages: Message[];
          inspection?: InspectionInfo;
        };
        setMessages(data.messages ?? []);
        if (data.inspection) setInspection(data.inspection);
      }
    } catch {
      /* silent */
    }
  }, [token]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  // Send message
  async function handleSend() {
    if (!composeBody.trim() || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/public/messages/${token}`, {
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

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <div className="max-w-2xl mx-auto py-8 px-4">
        <h1 className="text-2xl font-bold mb-2 text-slate-900 dark:text-slate-100">
          Messages
        </h1>
        {inspection && (
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
            Inspection: {inspection.propertyAddress}
          </p>
        )}

        {/* Message list */}
        <div className="space-y-3 max-h-[60vh] overflow-y-auto mb-4">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`rounded-md p-3 ${
                m.fromRole === "client"
                  ? "ml-12 bg-indigo-50 dark:bg-indigo-900/20"
                  : "mr-12 bg-amber-50 dark:bg-amber-900/20"
              }`}
            >
              <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">
                {m.fromName || m.fromRole} &middot;{" "}
                {new Date(m.createdAt).toLocaleString()}
              </div>
              <p className="text-sm whitespace-pre-wrap text-slate-900 dark:text-slate-100">
                {m.body}
              </p>
              {m.attachments && m.attachments.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {m.attachments.map((a) => (
                    <a
                      key={a.id}
                      href={`/api/photos/${encodeURIComponent(a.key)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-2 py-1 hover:bg-slate-50 dark:hover:bg-slate-600"
                    >
                      {a.name}
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
          {messages.length === 0 && (
            <div className="text-center py-8">
              <h3 className="font-semibold text-slate-600 dark:text-slate-400">
                No messages yet
              </h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                Send the first one below.
              </p>
            </div>
          )}
        </div>

        {/* Compose */}
        <div className="border-t border-slate-200 dark:border-slate-700 pt-3 bg-white dark:bg-slate-800 p-4 rounded-md">
          <textarea
            value={composeBody}
            onChange={(e) => setComposeBody(e.target.value)}
            rows={3}
            placeholder="Type your message..."
            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 text-sm resize-none bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 outline-none focus:border-indigo-500"
          />
          <div className="mt-2 flex items-center justify-end">
            <button
              type="button"
              onClick={handleSend}
              disabled={!composeBody.trim() || sending}
              className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold disabled:opacity-50 transition-opacity"
            >
              {sending ? "Sending..." : "Send"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
