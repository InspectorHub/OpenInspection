import { useState, useEffect, useCallback } from "react";

const ROLE_CHIP: Record<string, { label: string; bg: string; fg: string }> = {
  client: { label: "Buyer", bg: "#eef2ff", fg: "#4338ca" },
  agent_buyer: { label: "Buyer's Agent", bg: "#ecfeff", fg: "#0e7490" },
  agent_listing: { label: "Listing Agent", bg: "#fef3c7", fg: "#92400e" },
};

interface Recipient {
  contactId: string;
  name: string;
  role: string;
  email: string;
  phone: string;
  channels: { email: boolean; text: boolean };
}

interface PublishModalProps {
  open: boolean;
  onClose: () => void;
  inspectionId: string;
  onPublished?: () => void;
}

export function PublishModal({ open, onClose, inspectionId, onPublished }: PublishModalProps) {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [payload, setPayload] = useState<"report" | "agreement">("report");
  const [summary, setSummary] = useState("");
  const [publishedVersion] = useState(0);

  const selectedCount = recipients.reduce(
    (sum, r) => sum + (r.channels.email ? 1 : 0) + (r.channels.text ? 1 : 0),
    0
  );

  const loadRecipients = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/inspections/${inspectionId}/recipients`, { credentials: "include" });
      if (res.ok) {
        const data = (await res.json()) as { data: Recipient[] };
        setRecipients(
          (data.data || []).map((r) => ({
            ...r,
            channels: { email: !!r.email, text: !!r.phone },
          }))
        );
      }
    } catch {
      // graceful degrade
    } finally {
      setLoading(false);
    }
  }, [inspectionId]);

  useEffect(() => {
    if (open) loadRecipients();
  }, [open, loadRecipients]);

  if (!open) return null;

  function toggleChannel(idx: number, channel: "email" | "text") {
    setRecipients((prev) =>
      prev.map((r, i) =>
        i === idx ? { ...r, channels: { ...r.channels, [channel]: !r.channels[channel] } } : r
      )
    );
  }

  async function handlePublish() {
    setPublishing(true);
    try {
      const res = await fetch(`/api/inspections/${inspectionId}/publish`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipients, payload, summary: summary || undefined }),
      });
      if (res.ok) {
        onPublished?.();
        onClose();
      }
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-[rgba(15,23,42,0.7)] flex items-center justify-center p-6" onClick={onClose}>
      <div className="max-w-md w-full bg-ih-bg-card rounded-xl shadow-ih-popover max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-ih-border">
          <h2 className="text-xl font-bold text-ih-fg-1">Publish Report</h2>
        </div>

        <div className="p-6 space-y-4">
          {loading && <div className="text-center py-8 text-sm text-ih-fg-3" data-test="publish-loading">Loading recipients...</div>}

          {!loading && recipients.length === 0 && (
            <div className="text-center py-8" data-test="publish-empty-state">
              <p className="text-sm font-semibold text-ih-fg-3">There aren't any contacts to publish to.</p>
              <p className="text-xs text-ih-fg-3 mt-2">Add a client email/phone or link an agent under Settings to enable publish.</p>
            </div>
          )}

          {!loading && recipients.length > 0 && (
            <>
              {publishedVersion > 0 && (
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3 block">What changed in v{publishedVersion + 1}?</label>
                  <textarea rows={3} maxLength={500} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Optional — visible to the customer" className="w-full rounded-xl border border-ih-border bg-ih-bg-card px-3 py-2 text-sm text-ih-fg-1" />
                </div>
              )}

              <div className="space-y-2">
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3">Send a copy of</div>
                <div className="flex gap-2" data-test="publish-payload-radio">
                  {(["report", "agreement"] as const).map((opt) => (
                    <label key={opt} className="flex-1 cursor-pointer">
                      <input type="radio" value={opt} checked={payload === opt} onChange={() => setPayload(opt)} className="peer sr-only" />
                      <div className={`px-3 py-2 rounded-xl border text-sm font-semibold text-center transition-all ${payload === opt ? "bg-ih-primary-tint text-ih-primary border-ih-primary-tint" : "border-ih-border text-ih-fg-3"}`}>
                        The {opt}
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div className="space-y-2" data-test="publish-recipient-list">
                <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-1 text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3">
                  <span>Recipient</span>
                  <span className="w-12 text-center">Email</span>
                  <span className="w-12 text-center">Text</span>
                </div>
                {recipients.map((r, idx) => (
                  <div key={`${r.contactId}-${idx}`} className="grid grid-cols-[1fr_auto_auto] gap-3 items-center px-3 py-2 rounded-xl border border-ih-border bg-ih-bg-muted">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold truncate text-ih-fg-1">{r.name}</span>
                        {ROLE_CHIP[r.role] && (
                          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-full whitespace-nowrap" style={{ background: ROLE_CHIP[r.role].bg, color: ROLE_CHIP[r.role].fg }}>
                            {ROLE_CHIP[r.role].label}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] mt-0.5 truncate text-ih-fg-3">
                        {r.email}{r.email && r.phone ? " · " : ""}{r.phone}
                      </div>
                    </div>
                    <label className="w-12 flex justify-center">
                      <input type="checkbox" checked={r.channels.email} disabled={!r.email} onChange={() => toggleChannel(idx, "email")} className="rounded disabled:opacity-30" />
                    </label>
                    <label className="w-12 flex justify-center">
                      <input type="checkbox" checked={r.channels.text} disabled={!r.phone} onChange={() => toggleChannel(idx, "text")} className="rounded disabled:opacity-30" />
                    </label>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-ih-border flex gap-2">
          <button onClick={onClose} className="flex-1 h-10 px-4 text-sm font-semibold rounded-xl border border-ih-border bg-ih-bg-card text-ih-fg-3 hover:bg-ih-bg-muted">Cancel</button>
          {recipients.length > 0 && (
            <button onClick={handlePublish} disabled={publishing || selectedCount === 0} className="flex-1 h-10 px-4 rounded-xl text-sm font-semibold text-white bg-ih-primary hover:bg-ih-primary-600 disabled:opacity-40" data-test="publish-send-all">
              {publishing ? "Sending..." : "Send All"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
