import { useEffect, useState } from "react";
import type { AttachedRepairItem } from "~/hooks/useFindings";

interface RepairItemOption {
  id: string; name: string; category: string | null;
  defaultEstimateMin: number | null; defaultEstimateMax: number | null;
  defaultRepairSummary: string; contractorTypeName: string | null;
}

function estimateText(min: number | null, max: number | null): string {
  return [
    min != null ? `$${(min / 100).toLocaleString()}` : null,
    max != null ? `$${(max / 100).toLocaleString()}` : null,
  ].filter(Boolean).join(" – ");
}

export function RepairItemsPanel({
  attached, onAttach, onDetach,
}: {
  attached: AttachedRepairItem[];
  onAttach: (snap: AttachedRepairItem) => void;
  onDetach: (recommendationId: string) => void;
}) {
  const [catalog, setCatalog] = useState<RepairItemOption[]>([]);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/resources/repair-items", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((b) => { if (!cancelled) setCatalog((b as { items?: RepairItemOption[] }).items ?? []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const attachedIds = new Set(attached.map((a) => a.recommendationId));
  const filtered = catalog.filter((o) => !attachedIds.has(o.id) && (q.trim() === "" || o.name.toLowerCase().includes(q.toLowerCase())));

  function attach(o: RepairItemOption) {
    onAttach({
      recommendationId: o.id,
      estimateSnapshotMin: o.defaultEstimateMin,
      estimateSnapshotMax: o.defaultEstimateMax,
      summarySnapshot: o.defaultRepairSummary,
      contractorTypeSnapshot: o.contractorTypeName,
      attachedAt: Date.now(),
    });
    setQ("");
    setOpen(false);
  }

  return (
    <div className="mt-3 border-t border-ih-border pt-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-widest text-ih-fg-4">Repair items</span>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls="repair-items-disclosure" className="text-[12px] text-ih-primary font-bold hover:underline">+ Attach repair item</button>
      </div>

      {attached.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {attached.map((a) => {
            const est = estimateText(a.estimateSnapshotMin, a.estimateSnapshotMax);
            return (
              <li key={a.recommendationId} className="flex items-start justify-between gap-2 text-[12px]">
                <div>
                  <p className="text-ih-fg-2">{a.summarySnapshot}</p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    {est && (
                      <span className="text-[11px] tabular-nums text-ih-ok-fg">{est}</span>
                    )}
                    {a.contractorTypeSnapshot && <span className="text-[11px] text-ih-info-fg">{a.contractorTypeSnapshot}</span>}
                  </div>
                </div>
                <button type="button" onClick={() => onDetach(a.recommendationId)} className="text-ih-bad-fg hover:underline shrink-0" aria-label={`Remove ${a.summarySnapshot}`}>Remove</button>
              </li>
            );
          })}
        </ul>
      )}

      {open && (
        <div id="repair-items-disclosure" className="mt-2 border border-ih-border rounded-md p-2 bg-ih-bg-muted/40">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search repair items…" aria-label="Search repair items" autoFocus
            className="w-full px-2 py-1.5 rounded border border-ih-border bg-ih-bg-card text-[12px] text-ih-fg-1 focus:border-ih-primary outline-none" />
          <ul className="mt-2 max-h-48 overflow-auto divide-y divide-ih-border">
            {filtered.length === 0 ? (
              <li className="py-2 text-[12px] text-ih-fg-4">No matching repair items. Add some under Library → Repair Items.</li>
            ) : filtered.map((o) => (
              <li key={o.id}>
                <button type="button" onClick={() => attach(o)} className="w-full text-left py-2 hover:bg-ih-bg-card rounded px-1">
                  <span className="text-[12px] font-semibold text-ih-fg-1">{o.name}</span>
                  {o.contractorTypeName && <span className="ml-2 text-[11px] text-ih-info-fg">{o.contractorTypeName}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
