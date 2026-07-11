import { useRef, useState } from "react";
import { formatDollars } from "~/lib/money";
import { MoneyInput } from "~/components/MoneyInput";
import type { CostItemView } from "~/components/portal/sections/report/types";

/**
 * Commercial PCA Phase C Task 13b — the inspection-level Cost Items editor
 * panel (ASTM E2018 Table 1 / Opinion of Cost). Presentational: `items` is
 * fed in by the host (see `CostItemsHost.tsx`, which self-loads
 * `/resources/cost-items`); this component owns its OWN row edits and
 * mutations, submitting them straight to the same BFF resource route via a
 * plain `fetch(..., { credentials: "include" })` — mirrors
 * `RepairItemsPanel.tsx`'s fetcher usage (client code never calls `/api`
 * directly; see `reference_core_bff_no_client_fetch`).
 *
 * Row totals are re-derived here (server's `pca-costs.ts` isn't importable
 * from the browser): `quantity * unitCostCents` for the `unit` method,
 * `lumpSumCents` for `lump_sum`. A row under the ASTM $3,000 "immediate
 * repair" materiality threshold gets an inline note (never blocks saving —
 * advisory only).
 */

const ACTION_OPTIONS: Array<{ value: CostItemView["action"]; label: string }> = [
  { value: "repair", label: "Repair" },
  { value: "replace", label: "Replace" },
  { value: "further_study", label: "Further study" },
];

const COST_METHOD_OPTIONS: Array<{ value: CostItemView["costMethod"]; label: string }> = [
  { value: "lump_sum", label: "Lump sum" },
  { value: "unit", label: "Unit cost" },
];

const BUCKET_OPTIONS: Array<{ value: CostItemView["bucket"]; label: string }> = [
  { value: "immediate", label: "Immediate (0–1 yr)" },
  { value: "short_term", label: "Short-term (1–5 yr)" },
  { value: "long_term", label: "Long-term (reserve)" },
];

const THRESHOLD_CENTS = 300_000; // ASTM E2018 $3,000 immediate-repair materiality line.

function rowTotalCents(item: Pick<CostItemView, "costMethod" | "quantity" | "unitCostCents" | "lumpSumCents">): number {
  if (item.costMethod === "unit") return (item.quantity ?? 0) * (item.unitCostCents ?? 0);
  return item.lumpSumCents ?? 0;
}

function blankRow(sortOrder: number): CostItemView {
  return {
    id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    system: "", component: "", location: "",
    action: "repair", costMethod: "lump_sum",
    quantity: null, uom: null, unitCostCents: null, lumpSumCents: 0,
    eul: null, effAge: null, rul: null,
    suggestedRemedy: "", bucket: "immediate",
    sectionRef: null, photoRef: null, sortOrder,
  };
}

function isTempId(id: string): boolean {
  return id.startsWith("tmp-");
}

async function submitCostItem(
  inspectionId: string,
  intent: "create" | "update" | "delete",
  item: CostItemView,
): Promise<{ success: boolean; id?: string }> {
  const fd = new FormData();
  fd.set("intent", intent);
  fd.set("inspectionId", inspectionId);
  if (intent !== "create") fd.set("itemId", item.id);
  if (intent !== "delete") {
    fd.set("system", item.system);
    fd.set("component", item.component);
    fd.set("location", item.location ?? "");
    fd.set("action", item.action);
    fd.set("costMethod", item.costMethod);
    fd.set("quantity", item.quantity == null ? "" : String(item.quantity));
    fd.set("uom", item.uom ?? "");
    fd.set("unitCostCents", item.unitCostCents == null ? "" : String(item.unitCostCents));
    fd.set("lumpSumCents", item.lumpSumCents == null ? "" : String(item.lumpSumCents));
    fd.set("eul", item.eul == null ? "" : String(item.eul));
    fd.set("effAge", item.effAge == null ? "" : String(item.effAge));
    fd.set("rul", item.rul == null ? "" : String(item.rul));
    fd.set("suggestedRemedy", item.suggestedRemedy ?? "");
    fd.set("bucket", item.bucket);
    fd.set("sortOrder", String(item.sortOrder ?? 0));
  }
  try {
    const res = await fetch("/resources/cost-items", { method: "POST", credentials: "include", body: fd });
    if (!res.ok) return { success: false };
    return (await res.json()) as { success: boolean; id?: string };
  } catch {
    return { success: false };
  }
}

export function CostItemsPanel({
  inspectionId, items, reserveEnabled,
}: {
  inspectionId: string;
  items: CostItemView[];
  reserveEnabled: boolean;
}) {
  const [rows, setRows] = useState<CostItemView[]>(items);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  // Temp ids the user asked to remove while their initial background
  // `create` was still in flight (see `removeRow`) — cleaned up once that
  // create resolves, by immediately deleting the just-landed server row
  // instead of leaving it as an orphan. A ref (not state) because it's only
  // ever read/written from async callbacks, never rendered.
  const pendingRemovalRef = useRef<Set<string>>(new Set());

  const bucketTotals = { immediate: 0, short_term: 0, long_term: 0 } as Record<CostItemView["bucket"], number>;
  for (const row of rows) bucketTotals[row.bucket] += rowTotalCents(row);
  const grandTotalCents = bucketTotals.immediate + bucketTotals.short_term + bucketTotals.long_term;

  function patchRow(id: string, patch: Partial<CostItemView>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  async function commitRow(id: string) {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    // Guard against the temp-id create race: while a temp row's initial
    // `create` is still in flight (`saving[id]` true), its inputs are
    // disabled (see `CostItemRow`) so this normally can't fire — but keep
    // the check here too as defense-in-depth so a stray commit can never
    // issue a second `create` for the same row (which would land a
    // duplicate server row — see task-13b-report.md fix wave).
    if (isTempId(id) && saving[id]) return;
    setSaving((s) => ({ ...s, [id]: true }));
    const result = await submitCostItem(inspectionId, isTempId(id) ? "create" : "update", row);
    setSaving((s) => ({ ...s, [id]: false }));
    if (result.success && isTempId(id) && result.id) {
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, id: result.id! } : r)));
    }
  }

  function addRow() {
    const draft = blankRow(rows.length);
    setRows((prev) => [...prev, draft]);
    // Mark the row busy for the duration of its initial background create —
    // `CostItemRow` disables every input/select while `busy`, so no field
    // commit can race the create and fire a second one (see `commitRow`'s
    // matching guard, and the fix-wave note in task-13b-report.md).
    setSaving((s) => ({ ...s, [draft.id]: true }));
    void submitCostItem(inspectionId, "create", draft).then((result) => {
      setSaving((s) => { const next = { ...s }; delete next[draft.id]; return next; });
      const wasRemoved = pendingRemovalRef.current.delete(draft.id);
      if (result.success && result.id) {
        if (wasRemoved) {
          // The user removed this row while its create was still pending —
          // the local row is already gone from `rows`; the server row that
          // just landed would otherwise be a permanent orphan, so delete it
          // now that we finally have its real id.
          void submitCostItem(inspectionId, "delete", { ...draft, id: result.id });
          return;
        }
        setRows((cur) => cur.map((r) => (r.id === draft.id ? { ...r, id: result.id! } : r)));
      }
      // Create failed: nothing persisted server-side, so a pending removal
      // needs no follow-up — the row is already gone from `rows` (or, if not
      // removed, it stays a temp row the user can retry by editing it).
    });
  }

  async function removeRow(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id));
    if (isTempId(id)) {
      // Still-pending create for this row — queue the eventual delete
      // instead of silently dropping it (the zombie-row case: skipping the
      // delete here because "it's still temp" would otherwise leave the
      // server row created moments later with no local reference to it).
      if (saving[id]) pendingRemovalRef.current.add(id);
      return;
    }
    const row = items.find((r) => r.id === id) ?? rows.find((r) => r.id === id);
    if (row) await submitCostItem(inspectionId, "delete", row);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[13px] font-bold uppercase tracking-widest text-ih-fg-4">Cost Items</h2>
        <button
          type="button"
          onClick={addRow}
          className="text-[12px] text-ih-primary font-bold hover:underline"
        >
          + Add cost item
        </button>
      </div>

      <div className="rounded-ih-card border border-ih-border bg-ih-bg-card p-3">
        {rows.length > 0 && (
          <div className="grid grid-cols-3 gap-3 text-[12px] mb-2 pb-2 border-b border-ih-border">
            <div>
              <div className="text-ih-fg-4 uppercase tracking-wide text-[10px] font-bold">Immediate</div>
              <div className="tabular-nums text-ih-fg-1 font-bold">{formatDollars(bucketTotals.immediate)}</div>
            </div>
            <div>
              <div className="text-ih-fg-4 uppercase tracking-wide text-[10px] font-bold">Short-term</div>
              <div className="tabular-nums text-ih-fg-1 font-bold">{formatDollars(bucketTotals.short_term)}</div>
            </div>
            <div>
              <div className="text-ih-fg-4 uppercase tracking-wide text-[10px] font-bold">Long-term</div>
              <div className="tabular-nums text-ih-fg-1 font-bold">{formatDollars(bucketTotals.long_term)}</div>
            </div>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wide text-ih-fg-3">Running total</span>
          <span className="tabular-nums text-ih-fg-1 font-bold text-[14px]">{formatDollars(grandTotalCents)}</span>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-[12px] text-ih-fg-3">Nothing recorded yet — add a line to start the Opinion of Cost.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <CostItemRow
              key={row.id}
              item={row}
              reserveEnabled={reserveEnabled}
              busy={!!saving[row.id]}
              onChange={(patch) => patchRow(row.id, patch)}
              onCommit={() => commitRow(row.id)}
              onRemove={() => removeRow(row.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function CostItemRow({
  item, reserveEnabled, busy, onChange, onCommit, onRemove,
}: {
  item: CostItemView;
  reserveEnabled: boolean;
  busy: boolean;
  onChange: (patch: Partial<CostItemView>) => void;
  onCommit: () => void;
  onRemove: () => void;
}) {
  const total = rowTotalCents(item);
  const underThreshold = total > 0 && total < THRESHOLD_CENTS;

  return (
    <li className="rounded-ih-card border border-ih-border bg-ih-bg-card p-3 space-y-2">
      <div className="grid grid-cols-12 gap-2 text-[11px]">
        <div className="col-span-6 md:col-span-3">
          <label className="block font-bold uppercase tracking-[0.1em] text-ih-fg-4 mb-0.5">System</label>
          <input
            value={item.system}
            onChange={(e) => onChange({ system: e.target.value })}
            onBlur={onCommit}
            disabled={busy}
            placeholder="e.g. roof"
            className="w-full px-2 h-9 rounded border border-ih-border bg-ih-bg-app text-ih-fg-1"
          />
        </div>
        <div className="col-span-6 md:col-span-3">
          <label className="block font-bold uppercase tracking-[0.1em] text-ih-fg-4 mb-0.5">Component</label>
          <input
            value={item.component}
            onChange={(e) => onChange({ component: e.target.value })}
            onBlur={onCommit}
            disabled={busy}
            placeholder="e.g. membrane"
            className="w-full px-2 h-9 rounded border border-ih-border bg-ih-bg-app text-ih-fg-1"
          />
        </div>
        <div className="col-span-6 md:col-span-3">
          <label className="block font-bold uppercase tracking-[0.1em] text-ih-fg-4 mb-0.5">Location</label>
          <input
            value={item.location ?? ""}
            onChange={(e) => onChange({ location: e.target.value })}
            onBlur={onCommit}
            disabled={busy}
            className="w-full px-2 h-9 rounded border border-ih-border bg-ih-bg-app text-ih-fg-1"
          />
        </div>
        <div className="col-span-6 md:col-span-3">
          <label className="block font-bold uppercase tracking-[0.1em] text-ih-fg-4 mb-0.5">Action</label>
          <select
            value={item.action}
            onChange={(e) => { onChange({ action: e.target.value as CostItemView["action"] }); onCommit(); }}
            disabled={busy}
            className="w-full px-2 h-9 rounded border border-ih-border bg-ih-bg-app text-ih-fg-1"
          >
            {ACTION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        <div className="col-span-6 md:col-span-3">
          <label className="block font-bold uppercase tracking-[0.1em] text-ih-fg-4 mb-0.5">Cost method</label>
          <select
            value={item.costMethod}
            onChange={(e) => { onChange({ costMethod: e.target.value as CostItemView["costMethod"] }); onCommit(); }}
            disabled={busy}
            className="w-full px-2 h-9 rounded border border-ih-border bg-ih-bg-app text-ih-fg-1"
          >
            {COST_METHOD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        {item.costMethod === "unit" ? (
          <>
            <div className="col-span-4 md:col-span-2">
              <label className="block font-bold uppercase tracking-[0.1em] text-ih-fg-4 mb-0.5">Qty</label>
              <input
                type="number" min={0}
                value={item.quantity ?? ""}
                onChange={(e) => onChange({ quantity: e.target.value === "" ? null : Number(e.target.value) })}
                onBlur={onCommit}
                disabled={busy}
                className="w-full px-2 h-9 rounded border border-ih-border bg-ih-bg-app text-ih-fg-1"
              />
            </div>
            <div className="col-span-4 md:col-span-2">
              <label className="block font-bold uppercase tracking-[0.1em] text-ih-fg-4 mb-0.5">UOM</label>
              <input
                value={item.uom ?? ""}
                onChange={(e) => onChange({ uom: e.target.value || null })}
                onBlur={onCommit}
                disabled={busy}
                placeholder="sf, ea…"
                className="w-full px-2 h-9 rounded border border-ih-border bg-ih-bg-app text-ih-fg-1"
              />
            </div>
            <div className="col-span-4 md:col-span-2">
              <label className="block font-bold uppercase tracking-[0.1em] text-ih-fg-4 mb-0.5">Unit cost</label>
              <MoneyInput
                cents={item.unitCostCents}
                onChange={(c) => onChange({ unitCostCents: c })}
                onBlur={onCommit}
                disabled={busy}
                ariaLabel="Unit cost"
                className="w-full px-2 h-9 rounded border border-ih-border bg-ih-bg-app text-ih-fg-1"
              />
            </div>
          </>
        ) : (
          <div className="col-span-6 md:col-span-3">
            <label className="block font-bold uppercase tracking-[0.1em] text-ih-fg-4 mb-0.5">Lump sum</label>
            <MoneyInput
              cents={item.lumpSumCents}
              onChange={(c) => onChange({ lumpSumCents: c })}
              onBlur={onCommit}
              disabled={busy}
              ariaLabel="Lump sum"
              className="w-full px-2 h-9 rounded border border-ih-border bg-ih-bg-app text-ih-fg-1"
            />
          </div>
        )}

        <div className="col-span-6 md:col-span-3">
          <label className="block font-bold uppercase tracking-[0.1em] text-ih-fg-4 mb-0.5">Bucket</label>
          <select
            value={item.bucket}
            onChange={(e) => { onChange({ bucket: e.target.value as CostItemView["bucket"] }); onCommit(); }}
            disabled={busy}
            className="w-full px-2 h-9 rounded border border-ih-border bg-ih-bg-app text-ih-fg-1"
          >
            {BUCKET_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        {reserveEnabled && (
          <div className="col-span-12 rounded-md border border-ih-border bg-ih-bg-muted/40 p-2.5">
            <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.15em] text-ih-fg-4">
              Reserve schedule (Table 2) — expected / effective / remaining useful life (years)
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block whitespace-nowrap font-bold uppercase tracking-[0.1em] text-ih-fg-4 mb-0.5">EUL</label>
                <input
                  type="number" min={0}
                  value={item.eul ?? ""}
                  onChange={(e) => onChange({ eul: e.target.value === "" ? null : Number(e.target.value) })}
                  onBlur={onCommit}
                  disabled={busy}
                  className="w-full px-2 h-9 rounded border border-ih-border bg-ih-bg-app text-ih-fg-1"
                />
              </div>
              <div>
                <label className="block whitespace-nowrap font-bold uppercase tracking-[0.1em] text-ih-fg-4 mb-0.5">Eff. age</label>
                <input
                  type="number" min={0}
                  value={item.effAge ?? ""}
                  onChange={(e) => onChange({ effAge: e.target.value === "" ? null : Number(e.target.value) })}
                  onBlur={onCommit}
                  disabled={busy}
                  className="w-full px-2 h-9 rounded border border-ih-border bg-ih-bg-app text-ih-fg-1"
                />
              </div>
              <div>
                <label className="block whitespace-nowrap font-bold uppercase tracking-[0.1em] text-ih-fg-4 mb-0.5">RUL</label>
                <input
                  type="number" min={0}
                  value={item.rul ?? ""}
                  onChange={(e) => onChange({ rul: e.target.value === "" ? null : Number(e.target.value) })}
                  onBlur={onCommit}
                  disabled={busy}
                  className="w-full px-2 h-9 rounded border border-ih-border bg-ih-bg-app text-ih-fg-1"
                />
              </div>
            </div>
          </div>
        )}

        <div className="col-span-12">
          <label className="block font-bold uppercase tracking-[0.1em] text-ih-fg-4 mb-0.5">Suggested remedy</label>
          <input
            value={item.suggestedRemedy}
            onChange={(e) => onChange({ suggestedRemedy: e.target.value })}
            onBlur={onCommit}
            disabled={busy}
            className="w-full px-2 h-9 rounded border border-ih-border bg-ih-bg-app text-ih-fg-1"
          />
        </div>
      </div>

      <div className="flex items-center justify-between pt-1">
        <div className="text-[12px] tabular-nums text-ih-fg-2 font-bold">
          {formatDollars(total)}
          {underThreshold && (
            <span className="ml-2 px-1.5 py-0.5 rounded bg-ih-bg-muted text-ih-info-fg text-[11px] font-normal normal-case tracking-normal">
              below the $3,000 threshold
            </span>
          )}
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={onRemove}
          className="text-[11px] text-ih-bad-fg hover:underline disabled:opacity-50"
        >
          Remove
        </button>
      </div>
    </li>
  );
}
