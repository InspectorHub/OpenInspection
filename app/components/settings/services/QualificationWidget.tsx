import { useState, useEffect } from "react";
import { useFetcher } from "react-router";
import type { action } from "~/routes/settings-services";
import { m } from "~/paraglide/messages";

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
      ? m.settings_qual_all_inspectors()
      : initialUserIds.length !== 1
        ? m.settings_qual_inspectors_many({ count: initialUserIds.length })
        : m.settings_qual_inspectors_one({ count: initialUserIds.length });

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
        <span className="font-medium">{m.settings_qual_qualified_label()}</span> {displayLabel}
      </div>
    );
  }

  return (
    <div className="mt-2">
      {!open ? (
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-ih-fg-3">
            <span className="font-medium">{m.settings_qual_qualified_label()}</span> {displayLabel}
          </span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-[12px] font-semibold text-ih-primary hover:underline"
          >
            {m.common_edit()}
          </button>
          {saved && <span className="text-[12px] text-ih-ok-fg font-bold">{m.settings_holiday_saved()}</span>}
        </div>
      ) : (
        <div className="border border-ih-border rounded-md p-3 space-y-2 bg-ih-bg-muted">
          <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-ih-fg-3 mb-2">
            {m.settings_qual_heading()}
          </p>
          <p className="text-[12px] text-ih-fg-3 mb-2">
            {m.settings_qual_leave_unchecked()}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 max-h-40 overflow-y-auto">
            {members.map((member) => (
              <label key={member.id} className="flex items-center gap-2 cursor-pointer select-none py-1">
                <input
                  type="checkbox"
                  checked={selected.has(member.id)}
                  onChange={() => toggle(member.id)}
                  className="h-4 w-4 rounded border-ih-border text-ih-primary"
                />
                <span className="text-[12px] text-ih-fg-1 truncate">
                  {member.email}
                  <span className="ml-1 text-ih-fg-3 text-[11px]">({member.role})</span>
                </span>
              </label>
            ))}
          </div>
          {failed && (
            <p className="text-[12px] text-ih-bad-fg">
              {(lastResult as { message?: string }).message ?? m.settings_holiday_save_failed()}
            </p>
          )}
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="h-7 px-3 rounded-md bg-ih-primary text-white font-bold text-[12px] hover:bg-ih-primary-600 transition-colors disabled:opacity-50"
            >
              {saving ? m.common_saving() : m.common_save()}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              className="h-7 px-3 rounded-md border border-ih-border text-[12px] font-medium text-ih-fg-2 hover:bg-ih-bg-card transition-colors"
            >
              {m.common_cancel()}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
