import { useEffect, useRef, useState } from "react";
import { Button, useActionLatch } from "@core/shared-ui";
import { formatDollars } from "../../shared/money";
import { MoneyInput } from "../MoneyInput";
import { CostExportButtons } from "../CostExportButtons";
import { useFieldDataSource } from "../../context";
import type { CostItemView } from "../../data-source-types";
import { m } from "../../i18n";
import { THRESHOLD_CENTS, blankRow, isTempId, rowTotalCents, useCostItemWrite } from "./cost-items-rows";

/**
 * Commercial PCA Phase C Task 13b — the inspection-level Cost Items editor panel (ASTM E2018 Table 1 / Opinion of
 * Cost). Presentational: `items` is fed in by the host (see `CostItemsHost.tsx`); this component owns its own row
 * edits and writes them through the data source's `costItems.save` (one call per create, update or delete).
 *
 * Row totals are re-derived here (the server's `pca-costs.ts` is not importable from the browser). A row under the
 * ASTM $3,000 "immediate repair" materiality threshold gets an inline note (advisory only, never blocks saving).
 */

export function CostItemsPanel({
  inspectionId, items, reserveEnabled,
}: {
  inspectionId: string;
  items: CostItemView[];
  reserveEnabled: boolean;
}) {
  const dataSource = useFieldDataSource();
  const submitCostItem = useCostItemWrite(inspectionId);
  const [rows, setRows] = useState<CostItemView[]>(items);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [removeFailed, setRemoveFailed] = useState(false);
  // Temp ids removed while their `create` was still out: the server row that lands is deleted at once (no orphan).
  const pendingRemovalRef = useRef<Set<string>>(new Set());
  // Synchronous mirrors of the guards the render state (`saving`) only shows a frame late: the ids whose
  // create / update is out, and the ids whose delete is out. Two triggers in one frame meet these, not state.
  const writingRef = useRef<Set<string>>(new Set());
  const removingRef = useRef<Set<string>>(new Set());
  // Saved rows edited again while their update was out: re-committed (latest values) once it settles, so one
  // row never has two updates racing and an older PATCH can never land after a newer one.
  const dirtyRef = useRef<Set<string>>(new Set());
  // The rows as last rendered, for commits that run after an await.
  const rowsRef = useRef(rows);
  useEffect(() => { rowsRef.current = rows; });

  const bucketTotals = { immediate: 0, short_term: 0, long_term: 0 } as Record<CostItemView["bucket"], number>;
  for (const row of rows) bucketTotals[row.bucket] += rowTotalCents(row);
  const grandTotalCents = bucketTotals.immediate + bucketTotals.short_term + bucketTotals.long_term;

  function patchRow(id: string, patch: Partial<CostItemView>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  // `patch` carries a value picked in the same event (a select): the row state has not re-rendered yet, so
  // reading the rows alone would send the value from before the pick.
  async function commitRow(id: string, patch?: Partial<CostItemView>) {
    const base = rowsRef.current.find((r) => r.id === id);
    if (!base) return;
    // A temp row's create must never be sent twice (a duplicate server row); a saved row's update waits its turn.
    if (writingRef.current.has(id)) {
      if (!isTempId(id)) dirtyRef.current.add(id);
      return;
    }
    writingRef.current.add(id);
    setSaving((s) => ({ ...s, [id]: true }));
    const result = await submitCostItem(isTempId(id) ? "create" : "update", { ...base, ...patch });
    writingRef.current.delete(id);
    setSaving((s) => ({ ...s, [id]: false }));
    if (pendingRemovalRef.current.delete(id)) {
      if (result.success && result.id) void submitCostItem("delete", { ...base, id: result.id });
      return;
    }
    if (result.success) setRemoveFailed(false);
    if (result.success && isTempId(id) && result.id) {
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, id: result.id! } : r)));
    }
    if (dirtyRef.current.delete(id)) void commitRow(id);
  }

  // Two clicks in one frame would add two draft rows (and start two creates) before anything re-renders.
  const addLatch = useActionLatch(false);

  function addRow() {
    const draft = blankRow(rows.length);
    setRows((prev) => [...prev, draft]);
    // Busy while its create is out: `CostItemRow` disables its inputs, and `commitRow` refuses a second create.
    writingRef.current.add(draft.id);
    setSaving((s) => ({ ...s, [draft.id]: true }));
    void submitCostItem("create", draft).then((result) => {
      writingRef.current.delete(draft.id);
      setSaving((s) => { const next = { ...s }; delete next[draft.id]; return next; });
      const wasRemoved = pendingRemovalRef.current.delete(draft.id);
      if (result.success && result.id) {
        if (wasRemoved) {
          // Removed while the create was out: delete the row that just landed rather than orphan it.
          void submitCostItem("delete", { ...draft, id: result.id });
          return;
        }
        setRows((cur) => cur.map((r) => (r.id === draft.id ? { ...r, id: result.id! } : r)));
      }
      // A failed create persisted nothing: a removed row needs no follow-up, a kept one stays a retryable temp row.
    });
  }

  async function removeRow(id: string) {
    // Two presses in one frame remove (and delete) the row once.
    if (removingRef.current.has(id)) return;
    removingRef.current.add(id);
    const index = rows.findIndex((r) => r.id === id);
    const row = rows[index];
    setRemoveFailed(false);
    setRows((prev) => prev.filter((r) => r.id !== id));
    if (isTempId(id)) {
      // Still-pending create for this row — queue the eventual delete
      // instead of silently dropping it (the zombie-row case: skipping the
      // delete here because "it's still temp" would otherwise leave the
      // server row created moments later with no local reference to it).
      if (writingRef.current.has(id)) pendingRemovalRef.current.add(id);
      removingRef.current.delete(id);
      return;
    }
    if (!row) {
      removingRef.current.delete(id);
      return;
    }
    const result = await submitCostItem("delete", row);
    removingRef.current.delete(id);
    if (result.success) return;
    // Not confirmed: the row is still on the server, so it comes back where it was.
    setRows((prev) => (prev.some((r) => r.id === id) ? prev : [...prev.slice(0, Math.max(index, 0)), row, ...prev.slice(Math.max(index, 0))]));
    setRemoveFailed(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[13px] font-bold uppercase tracking-widest text-ih-fg-3">{m.editor_cost_items_title()}</h2>
        <div className="flex items-center gap-3">
          {/* Export the current Opinion of Cost — only worth offering once at
              least one line exists (empty exports are just a header row). */}
          {rows.length > 0 && (
            <CostExportButtons hrefFor={(format) => dataSource.urls.costExport(inspectionId, format)} variant="panel" />
          )}
          <Button variant="link" size="sm" onClick={() => addLatch(addRow)}>
            {m.editor_cost_add_item()}
          </Button>
        </div>
      </div>

      {removeFailed && <p role="alert" className="text-[12px] font-medium text-ih-bad-fg">{m.editor_cost_remove_failed()}</p>}

      <div className="rounded-ih-card border border-ih-border bg-ih-bg-card p-3">
        {rows.length > 0 && (
          <div className="grid grid-cols-3 gap-3 text-[12px] mb-2 pb-2 border-b border-ih-border">
            <div>
              <div className="text-ih-fg-3 uppercase tracking-wide text-[10px] font-bold">{m.editor_cost_total_immediate()}</div>
              <div className="tabular-nums text-ih-fg-1 font-bold">{formatDollars(bucketTotals.immediate)}</div>
            </div>
            <div>
              <div className="text-ih-fg-3 uppercase tracking-wide text-[10px] font-bold">{m.editor_cost_total_short_term()}</div>
              <div className="tabular-nums text-ih-fg-1 font-bold">{formatDollars(bucketTotals.short_term)}</div>
            </div>
            <div>
              <div className="text-ih-fg-3 uppercase tracking-wide text-[10px] font-bold">{m.editor_cost_total_long_term()}</div>
              <div className="tabular-nums text-ih-fg-1 font-bold">{formatDollars(bucketTotals.long_term)}</div>
            </div>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wide text-ih-fg-3">{m.editor_cost_running_total()}</span>
          <span className="tabular-nums text-ih-fg-1 font-bold text-[14px]">{formatDollars(grandTotalCents)}</span>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-[12px] text-ih-fg-3">{m.editor_cost_empty()}</p>
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
              onPick={(patch) => { patchRow(row.id, patch); void commitRow(row.id, patch); }}
              onRemove={() => removeRow(row.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function CostItemRow({
  item, reserveEnabled, busy, onChange, onCommit, onPick, onRemove,
}: {
  item: CostItemView;
  reserveEnabled: boolean;
  busy: boolean;
  onChange: (patch: Partial<CostItemView>) => void;
  onCommit: () => void;
  /** A value picked from a select: change and commit it together. */
  onPick: (patch: Partial<CostItemView>) => void;
  onRemove: () => void;
}) {
  const total = rowTotalCents(item);
  const underThreshold = total > 0 && total < THRESHOLD_CENTS;

  // Option labels are built in render so the message functions resolve
  // per-render (never frozen at import). The `value`s are the persisted enum
  // members and stay as-is.
  const ACTION_OPTIONS: Array<{ value: CostItemView["action"]; label: string }> = [
    { value: "repair", label: m.editor_cost_action_repair() },
    { value: "replace", label: m.editor_cost_action_replace() },
    { value: "further_study", label: m.editor_cost_action_further_study() },
  ];
  const COST_METHOD_OPTIONS: Array<{ value: CostItemView["costMethod"]; label: string }> = [
    { value: "lump_sum", label: m.editor_cost_method_lump_sum() },
    { value: "unit", label: m.editor_cost_method_unit() },
  ];
  const BUCKET_OPTIONS: Array<{ value: CostItemView["bucket"]; label: string }> = [
    { value: "immediate", label: m.editor_cost_bucket_immediate() },
    { value: "short_term", label: m.editor_cost_bucket_short_term() },
    { value: "long_term", label: m.editor_cost_bucket_long_term() },
  ];

  return (
    <li className="rounded-ih-card border border-ih-border bg-ih-bg-card p-3 space-y-2">
      <div className="grid grid-cols-12 gap-2 text-[11px]">
        <div className="col-span-6 md:col-span-3">
          <label className="block font-bold uppercase tracking-[0.1em] text-ih-fg-4 mb-0.5">{m.editor_cost_field_system()}</label>
          <input
            value={item.system}
            onChange={(e) => onChange({ system: e.target.value })}
            onBlur={onCommit}
            disabled={busy}
            placeholder={m.editor_cost_placeholder_system()}
            className="w-full px-2 h-9 rounded border border-ih-border bg-ih-bg-app text-ih-fg-1"
          />
        </div>
        <div className="col-span-6 md:col-span-3">
          <label className="block font-bold uppercase tracking-[0.1em] text-ih-fg-4 mb-0.5">{m.editor_cost_field_component()}</label>
          <input
            value={item.component}
            onChange={(e) => onChange({ component: e.target.value })}
            onBlur={onCommit}
            disabled={busy}
            placeholder={m.editor_cost_placeholder_component()}
            className="w-full px-2 h-9 rounded border border-ih-border bg-ih-bg-app text-ih-fg-1"
          />
        </div>
        <div className="col-span-6 md:col-span-3">
          <label className="block font-bold uppercase tracking-[0.1em] text-ih-fg-4 mb-0.5">{m.editor_cost_field_location()}</label>
          <input
            value={item.location ?? ""}
            onChange={(e) => onChange({ location: e.target.value })}
            onBlur={onCommit}
            disabled={busy}
            className="w-full px-2 h-9 rounded border border-ih-border bg-ih-bg-app text-ih-fg-1"
          />
        </div>
        <div className="col-span-6 md:col-span-3">
          <label className="block font-bold uppercase tracking-[0.1em] text-ih-fg-4 mb-0.5">{m.editor_cost_field_action()}</label>
          <select
            value={item.action}
            onChange={(e) => onPick({ action: e.target.value as CostItemView["action"] })}
            disabled={busy}
            className="w-full px-2 h-9 rounded border border-ih-border bg-ih-bg-app text-ih-fg-1"
          >
            {ACTION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        <div className="col-span-6 md:col-span-3">
          <label className="block font-bold uppercase tracking-[0.1em] text-ih-fg-4 mb-0.5">{m.editor_cost_field_cost_method()}</label>
          <select
            value={item.costMethod}
            onChange={(e) => onPick({ costMethod: e.target.value as CostItemView["costMethod"] })}
            disabled={busy}
            className="w-full px-2 h-9 rounded border border-ih-border bg-ih-bg-app text-ih-fg-1"
          >
            {COST_METHOD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        {item.costMethod === "unit" ? (
          <>
            <div className="col-span-4 md:col-span-2">
              <label className="block font-bold uppercase tracking-[0.1em] text-ih-fg-4 mb-0.5">{m.editor_cost_field_qty()}</label>
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
              <label className="block font-bold uppercase tracking-[0.1em] text-ih-fg-4 mb-0.5">{m.editor_cost_field_uom()}</label>
              <input
                value={item.uom ?? ""}
                onChange={(e) => onChange({ uom: e.target.value || null })}
                onBlur={onCommit}
                disabled={busy}
                placeholder={m.editor_cost_placeholder_uom()}
                className="w-full px-2 h-9 rounded border border-ih-border bg-ih-bg-app text-ih-fg-1"
              />
            </div>
            <div className="col-span-4 md:col-span-2">
              <label className="block font-bold uppercase tracking-[0.1em] text-ih-fg-4 mb-0.5">{m.editor_cost_unit_cost()}</label>
              <MoneyInput
                cents={item.unitCostCents}
                onChange={(c) => onChange({ unitCostCents: c })}
                onBlur={onCommit}
                disabled={busy}
                ariaLabel={m.editor_cost_unit_cost()}
                className="w-full px-2 h-9 rounded border border-ih-border bg-ih-bg-app text-ih-fg-1"
              />
            </div>
          </>
        ) : (
          <div className="col-span-6 md:col-span-3">
            <label className="block font-bold uppercase tracking-[0.1em] text-ih-fg-4 mb-0.5">{m.editor_cost_lump_sum()}</label>
            <MoneyInput
              cents={item.lumpSumCents}
              onChange={(c) => onChange({ lumpSumCents: c })}
              onBlur={onCommit}
              disabled={busy}
              ariaLabel={m.editor_cost_lump_sum()}
              className="w-full px-2 h-9 rounded border border-ih-border bg-ih-bg-app text-ih-fg-1"
            />
          </div>
        )}

        <div className="col-span-6 md:col-span-3">
          <label className="block font-bold uppercase tracking-[0.1em] text-ih-fg-4 mb-0.5">{m.editor_cost_field_bucket()}</label>
          <select
            value={item.bucket}
            onChange={(e) => onPick({ bucket: e.target.value as CostItemView["bucket"] })}
            disabled={busy}
            className="w-full px-2 h-9 rounded border border-ih-border bg-ih-bg-app text-ih-fg-1"
          >
            {BUCKET_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        {reserveEnabled && (
          <div className="col-span-12 rounded-md border border-ih-border bg-ih-bg-muted/40 p-2.5">
            <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">
              {m.editor_cost_reserve_schedule()}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block whitespace-nowrap font-bold uppercase tracking-[0.1em] text-ih-fg-4 mb-0.5">{m.editor_cost_field_eul()}</label>
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
                <label className="block whitespace-nowrap font-bold uppercase tracking-[0.1em] text-ih-fg-4 mb-0.5">{m.editor_cost_field_eff_age()}</label>
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
                <label className="block whitespace-nowrap font-bold uppercase tracking-[0.1em] text-ih-fg-4 mb-0.5">{m.editor_cost_field_rul()}</label>
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
          <label className="block font-bold uppercase tracking-[0.1em] text-ih-fg-4 mb-0.5">{m.editor_cost_field_suggested_remedy()}</label>
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
              {m.editor_cost_below_threshold()}
            </span>
          )}
        </div>
        <Button variant="danger-link" size="sm" pending={busy} onClick={onRemove}>
          {m.common_remove()}
        </Button>
      </div>
    </li>
  );
}
