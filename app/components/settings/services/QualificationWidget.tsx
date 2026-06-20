import { useState, useEffect } from "react";
import { useFetcher } from "react-router";
import type { action } from "~/routes/settings-services";

interface Service {
  id: string;
  name: string;
  description: string | null;
  price: number | null;
  active: boolean;
}

interface Member {
  id: string;
  email: string;
  role: string;
  createdAt: string;
}

interface QualificationWidgetProps {
  service: Service;
  initialUserIds: string[];
  members: Member[];
}

export function QualificationWidget({ service, initialUserIds, members }: QualificationWidgetProps) {
  const fetcher = useFetcher<typeof action>({ key: `qual-${service.id}` });
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set(initialUserIds));
  const [dirty, setDirty] = useState(false);

  // Re-sync local selection when the loader delivers a fresh restrictionMap
  // (e.g. after a full-page navigation or revalidation).
  useEffect(() => {
    setSelected(new Set(initialUserIds));
    setDirty(false);
  }, [initialUserIds]);

  const saving = fetcher.state !== "idle";
  const lastResult = fetcher.state === "idle" ? fetcher.data : undefined;
  const saved =
    !dirty &&
    lastResult !== undefined &&
    "intent" in lastResult &&
    lastResult.intent === "qualification-save" &&
    (lastResult as { ok: boolean }).ok === true &&
    "serviceId" in lastResult &&
    (lastResult as { serviceId: string }).serviceId === service.id;
  const failed =
    !dirty &&
    lastResult !== undefined &&
    "intent" in lastResult &&
    lastResult.intent === "qualification-save" &&
    (lastResult as { ok: boolean }).ok === false &&
    "serviceId" in lastResult &&
    (lastResult as { serviceId: string }).serviceId === service.id;

  const displayLabel =
    initialUserIds.length === 0
      ? "All inspectors"
      : `${initialUserIds.length} inspector${initialUserIds.length !== 1 ? "s" : ""}`;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setDirty(true);
  }

  function handleSave() {
    setDirty(false);
    fetcher.submit(
      {
        intent: "qualification-save",
        serviceId: service.id,
        userIds: JSON.stringify(Array.from(selected)),
      },
      { method: "post" },
    );
  }

  function handleCancel() {
    setSelected(new Set(initialUserIds));
    setDirty(false);
    setOpen(false);
  }

  // Read-only display when no scheduling members are available (non-admin).
  if (members.length === 0) {
    return (
      <div className="text-[12px] text-ih-fg-3">
        <span className="font-medium">Qualified:</span> {displayLabel}
      </div>
    );
  }

  return (
    <div className="mt-2">
      {!open ? (
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-ih-fg-3">
            <span className="font-medium">Qualified:</span> {displayLabel}
          </span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-[12px] font-semibold text-ih-primary hover:underline"
          >
            Edit
          </button>
          {saved && <span className="text-[12px] text-ih-ok-fg font-bold">Saved.</span>}
        </div>
      ) : (
        <div className="border border-ih-border rounded-md p-3 space-y-2 bg-ih-bg-muted">
          <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-ih-fg-3 mb-2">
            Qualified inspectors
          </p>
          <p className="text-[12px] text-ih-fg-3 mb-2">
            Leave all unchecked to allow all staff.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 max-h-40 overflow-y-auto">
            {members.map((m) => (
              <label key={m.id} className="flex items-center gap-2 cursor-pointer select-none py-1">
                <input
                  type="checkbox"
                  checked={selected.has(m.id)}
                  onChange={() => toggle(m.id)}
                  className="h-4 w-4 rounded border-ih-border text-ih-primary"
                />
                <span className="text-[12px] text-ih-fg-1 truncate">
                  {m.email}
                  <span className="ml-1 text-ih-fg-3 text-[11px]">({m.role})</span>
                </span>
              </label>
            ))}
          </div>
          {failed && (
            <p className="text-[12px] text-ih-bad-fg">
              {(lastResult as { message?: string }).message ?? "Save failed. Please try again."}
            </p>
          )}
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="h-7 px-3 rounded-md bg-ih-primary text-white font-bold text-[12px] hover:bg-ih-primary-600 transition-colors disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              className="h-7 px-3 rounded-md border border-ih-border text-[12px] font-medium text-ih-fg-2 hover:bg-ih-bg-card transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
