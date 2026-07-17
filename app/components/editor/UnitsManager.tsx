import { useEffect, useState } from "react";
import type { useFetcher } from "react-router";
import { Drawer, Modal, Button, Input, IconButton, SegmentedControl } from "@core/shared-ui";
import type { UnitScopeRow } from "./BreadcrumbDropdown";
import { m } from "~/paraglide/messages";

type UnitsFetcher = ReturnType<typeof useFetcher>;

export interface UnitsManagerProps {
  open: boolean;
  onClose: () => void;
  inspectionId: string;
  /** Flat unit rows (the loader's `units`). */
  units: UnitScopeRow[];
  /** Current unit-inspection mode. */
  mode: "tagged" | "per_unit";
  /**
   * Shared fetcher the editor watches to revalidate the loader after a unit
   * mutation. Every write in this panel submits through it (BFF relay).
   */
  fetcher: UnitsFetcher;
}

/**
 * Commercial PCA Phase U (Batch C2b) — the units management panel.
 *
 * A right-side Drawer that hosts: the unit CRUD list (add / rename / duplicate /
 * remove), a bulk-create form (floors × stacks or CSV paste), and the mode
 * switch. The lossy `per_unit → tagged` direction is gated behind a custom DS
 * Modal (never window.confirm) because it drops every unit's findings back to
 * the common scope and deletes the promoted unit rows. `tagged → per_unit` is
 * non-lossy and fires directly.
 *
 * All writes route through the editor route action (`fetcher.submit`), never a
 * bare client fetch — the action holds the authed tenant context.
 */
export function UnitsManager({ open, onClose, inspectionId, units, mode, fetcher }: UnitsManagerProps) {
  const [showLossy, setShowLossy] = useState(false);
  const busy = fetcher.state !== "idle";

  // Close the lossy-confirm modal once the switch lands (the editor revalidates
  // and re-renders in tagged mode).
  useEffect(() => {
    const d = fetcher.data as { ok?: boolean; intent?: string } | undefined;
    if (d?.intent === "unit-mode-switch" && d.ok) setShowLossy(false);
  }, [fetcher.data]);

  const unitRows = units.filter((u) => (u.kind ?? "unit") === "unit");

  const submit = (fields: Record<string, string>) => {
    fetcher.submit({ ...fields }, { method: "POST" });
  };

  return (
    <>
      <Drawer open={open} onClose={onClose} title={m.editor_unitsmanager_title()} wide>
        <div className="space-y-6">
          {/* Mode section */}
          <section>
            <h3 className="text-[11px] font-bold uppercase tracking-wide text-ih-fg-3 mb-2">{m.editor_unitsmanager_mode_heading()}</h3>
            <div className="rounded-ih-card border border-ih-border p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[13px] font-bold text-ih-fg-1">
                    {mode === "per_unit" ? m.editor_unitsmanager_mode_per_unit() : m.editor_unitsmanager_mode_tagged()}
                  </div>
                  <p className="text-[12px] text-ih-fg-3 mt-0.5">
                    {mode === "per_unit"
                      ? m.editor_unitsmanager_mode_per_unit_desc()
                      : m.editor_unitsmanager_mode_tagged_desc()}
                  </p>
                </div>
                {mode === "per_unit" ? (
                  <Button variant="secondary" size="sm" disabled={busy} onClick={() => setShowLossy(true)}>
                    {m.editor_unitsmanager_switch_to_tagged()}
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() => submit({ intent: "unit-mode-switch", mode: "per_unit" })}
                  >
                    {m.editor_unitsmanager_switch_to_per_unit()}
                  </Button>
                )}
              </div>
            </div>
          </section>

          {/* Unit list */}
          <section>
            <h3 className="text-[11px] font-bold uppercase tracking-wide text-ih-fg-3 mb-2">
              {m.editor_unitsmanager_title()}{unitRows.length > 0 ? ` (${unitRows.length})` : ""}
            </h3>
            {unitRows.length === 0 ? (
              <p className="text-[12px] text-ih-fg-3 mb-3">{m.editor_unitsmanager_no_units()}</p>
            ) : (
              <ul className="space-y-1.5 mb-3">
                {unitRows.map((u) => (
                  <UnitRow key={`${u.id}:${u.name}`} unit={u} busy={busy} onSubmit={submit} />
                ))}
              </ul>
            )}
            <AddUnitForm busy={busy} onSubmit={submit} />
          </section>

          {/* Bulk create */}
          <section>
            <h3 className="text-[11px] font-bold uppercase tracking-wide text-ih-fg-3 mb-2">{m.editor_unitsmanager_bulk_create_heading()}</h3>
            <BulkCreateForm busy={busy} onSubmit={submit} />
          </section>
        </div>
      </Drawer>

      {/* Lossy per_unit → tagged confirm — custom DS modal, never window.confirm. */}
      <Modal
        open={showLossy}
        onClose={() => setShowLossy(false)}
        title={m.editor_unitsmanager_lossy_title()}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowLossy(false)}>
              {m.common_cancel()}
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => submit({ intent: "unit-mode-switch", mode: "tagged" })}
            >
              {m.editor_unitsmanager_switch_flatten()}
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-ih-fg-2">
          {m.editor_unitsmanager_lossy_body_1()}{" "}
          <span className="font-bold">{unitRows.length === 1 ? m.editor_unitsmanager_lossy_delete_one({ count: unitRows.length }) : m.editor_unitsmanager_lossy_delete_many({ count: unitRows.length })}</span>
          {m.editor_unitsmanager_lossy_body_2()}
        </p>
      </Modal>
    </>
  );

  // inspectionId is part of the URL the action already binds; kept in props so
  // the panel is self-describing and future direct-fetch paths have it.
  void inspectionId;
}

/* ------------------------------------------------------------------ */
/* A single editable unit row.                                        */
/* ------------------------------------------------------------------ */

function UnitRow({
  unit,
  busy,
  onSubmit,
}: {
  unit: UnitScopeRow;
  busy: boolean;
  onSubmit: (fields: Record<string, string>) => void;
}) {
  const [name, setName] = useState(unit.name);
  const trimmed = name.trim();

  const commitRename = () => {
    if (trimmed && trimmed !== unit.name) {
      onSubmit({ intent: "unit-rename", unitId: unit.id, name: trimmed });
    } else {
      setName(unit.name);
    }
  };

  return (
    <li className="flex items-center gap-1.5">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commitRename}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setName(unit.name);
        }}
        aria-label={m.editor_unitsmanager_rename_aria({ name: unit.name })}
        maxLength={80}
        className="flex-1 h-8 px-2.5 rounded-ih-input border border-ih-border bg-ih-bg-app text-[13px] text-ih-fg-1"
      />
      <IconButton
        disabled={busy}
        onClick={() => onSubmit({ intent: "unit-duplicate", unitId: unit.id })}
        title={m.editor_unitsmanager_duplicate_title()}
        aria-label={m.editor_unitsmanager_duplicate_aria({ name: unit.name })}
        size="md"
        className="w-8 h-8 text-ih-fg-3"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
        </svg>
      </IconButton>
      <IconButton
        disabled={busy}
        onClick={() => onSubmit({ intent: "unit-delete", unitId: unit.id })}
        title={m.editor_unitsmanager_remove_title()}
        aria-label={m.editor_unitsmanager_remove_aria({ name: unit.name })}
        size="md"
        className="w-8 h-8 text-ih-fg-3 hover:text-ih-bad"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      </IconButton>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Add a single unit.                                                 */
/* ------------------------------------------------------------------ */

function AddUnitForm({ busy, onSubmit }: { busy: boolean; onSubmit: (fields: Record<string, string>) => void }) {
  const [name, setName] = useState("");
  const trimmed = name.trim();

  const add = () => {
    if (!trimmed) return;
    onSubmit({ intent: "unit-create", name: trimmed });
    setName("");
  };

  return (
    <div className="flex items-center gap-1.5">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
        placeholder={m.editor_unitsmanager_new_unit_name()}
        maxLength={80}
        aria-label={m.editor_unitsmanager_new_unit_name()}
        className="flex-1 h-8 px-2.5 rounded-ih-input border border-ih-border bg-ih-bg-app text-[13px] text-ih-fg-1 placeholder:text-ih-fg-4"
      />
      <Button variant="secondary" size="sm" disabled={busy || !trimmed} onClick={add}>
        {m.common_add()}
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Bulk create — floors × stacks OR CSV paste.                        */
/* ------------------------------------------------------------------ */

function BulkCreateForm({ busy, onSubmit }: { busy: boolean; onSubmit: (fields: Record<string, string>) => void }) {
  const [tab, setTab] = useState<"grid" | "csv">("grid");
  const [floors, setFloors] = useState("3");
  const [stacks, setStacks] = useState("4");
  const [startAt, setStartAt] = useState("1");
  const [csv, setCsv] = useState("");

  const floorsCount = Math.max(0, Math.floor(Number(floors) || 0));
  const stacksCount = Math.max(0, Math.floor(Number(stacks) || 0));
  const startAtNum = Math.max(0, Math.floor(Number(startAt) || 0));
  const gridCount = floorsCount * stacksCount;
  const csvCount = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).length;

  const createGrid = () => {
    if (gridCount <= 0) return;
    const payload = {
      mode: "floors_stacks" as const,
      floors: Array.from({ length: floorsCount }, (_, i) => i + 1),
      stacks: stacksCount,
      startAt: startAtNum,
    };
    onSubmit({ intent: "unit-bulk-create", payload: JSON.stringify(payload) });
  };

  const createCsv = () => {
    if (!csv.trim()) return;
    onSubmit({ intent: "unit-bulk-create", payload: JSON.stringify({ mode: "csv", csv }) });
  };

  return (
    <div className="rounded-ih-card border border-ih-border p-3 space-y-3">
      <SegmentedControl
        options={[
          { value: "grid", label: m.editor_unitsmanager_bulk_grid_label() },
          { value: "csv", label: m.editor_unitsmanager_bulk_csv_label() },
        ]}
        value={tab}
        onChange={(v) => setTab(v as "grid" | "csv")}
        ariaLabel={m.editor_unitsmanager_bulk_method_aria()}
      />

      {tab === "grid" ? (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <label className="text-[11px] font-bold text-ih-fg-3">
              {m.editor_unitsmanager_floors_label()}
              <Input
                type="number"
                min={1}
                max={200}
                value={floors}
                onChange={(e) => setFloors(e.target.value)}
                aria-label={m.editor_unitsmanager_floors_aria()}
                className="mt-1"
              />
            </label>
            <label className="text-[11px] font-bold text-ih-fg-3">
              {m.editor_unitsmanager_units_per_floor_label()}
              <Input
                type="number"
                min={1}
                max={200}
                value={stacks}
                onChange={(e) => setStacks(e.target.value)}
                aria-label={m.editor_unitsmanager_units_per_floor_aria()}
                className="mt-1"
              />
            </label>
            <label className="text-[11px] font-bold text-ih-fg-3">
              {m.editor_unitsmanager_start_at_label()}
              <Input
                type="number"
                min={0}
                value={startAt}
                onChange={(e) => setStartAt(e.target.value)}
                aria-label={m.editor_unitsmanager_start_at_aria()}
                className="mt-1"
              />
            </label>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-ih-fg-4 tabular-nums">
              {gridCount > 0 ? (gridCount === 1 ? m.editor_unitsmanager_creates_one({ count: gridCount }) : m.editor_unitsmanager_creates_many({ count: gridCount })) : m.editor_unitsmanager_grid_hint()}
            </span>
            <Button variant="primary" size="sm" disabled={busy || gridCount <= 0} onClick={createGrid}>
              {m.editor_unitsmanager_create_units()}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <textarea
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            placeholder={m.editor_unitsmanager_csv_placeholder()}
            rows={5}
            aria-label={m.editor_unitsmanager_csv_aria()}
            className="w-full px-2.5 py-2 rounded-ih-input border border-ih-border bg-ih-bg-app text-[13px] text-ih-fg-1 font-mono"
          />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-ih-fg-4 tabular-nums">
              {csvCount > 0 ? (csvCount === 1 ? m.editor_unitsmanager_row_one({ count: csvCount }) : m.editor_unitsmanager_row_many({ count: csvCount })) : m.editor_unitsmanager_csv_hint()}
            </span>
            <Button variant="primary" size="sm" disabled={busy || csvCount <= 0} onClick={createCsv}>
              {m.editor_unitsmanager_create_units()}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
