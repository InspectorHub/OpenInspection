import { useState } from "react";

const REASONS = [
  { value: "client_cancelled", label: "Client cancelled" },
  { value: "weather", label: "Weather" },
  { value: "inspector_unavailable", label: "Inspector unavailable" },
  { value: "property_unavailable", label: "Property unavailable" },
  { value: "rescheduled", label: "Rescheduled" },
  { value: "other", label: "Other" },
] as const;

interface CancelModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string, notes: string) => void;
  inspectionId: string;
}

export function CancelModal({ open, onClose, onConfirm, inspectionId }: CancelModalProps) {
  const [reason, setReason] = useState("client_cancelled");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  async function handleSubmit() {
    if (!inspectionId || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/inspections/${inspectionId}/cancel`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason, notes: notes || undefined }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: { message?: string } })?.error?.message || `HTTP ${res.status}`);
      }
      onConfirm(reason, notes);
      onClose();
    } catch (e) {
      console.error("Cancel failed:", e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-[rgba(15,23,42,0.7)] flex items-center justify-center p-6" onClick={onClose}>
      <div className="max-w-md w-full p-6 bg-ih-bg-card rounded-xl shadow-ih-popover" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-bold mb-4 text-ih-fg-1">Cancel inspection</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-bold text-ih-fg-3 mb-1 uppercase tracking-wider">Reason</label>
            <select value={reason} onChange={(e) => setReason(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-ih-border bg-ih-bg-card text-sm text-ih-fg-1">
              {REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-ih-fg-3 mb-1 uppercase tracking-wider">Notes (optional)</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={500} placeholder="Optional details..." className="w-full px-3 py-2 rounded-lg border border-ih-border bg-ih-bg-card text-sm text-ih-fg-1" />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-ih-border">
          <button onClick={onClose} className="px-4 h-10 rounded-xl border border-ih-border text-sm font-semibold text-ih-fg-3 hover:bg-ih-bg-muted">Back</button>
          <button onClick={handleSubmit} disabled={busy} className="px-4 h-10 rounded-xl bg-ih-bad text-white text-sm font-semibold hover:bg-ih-bad/85 disabled:opacity-50">
            {busy ? "Cancelling..." : "Cancel inspection"}
          </button>
        </div>
      </div>
    </div>
  );
}
