import { useState, useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import type { action } from "~/routes/settings-booking";

interface DateOverride {
  id: string;
  date: string;
  isAvailable: boolean;
  startTime: string | null;
  endTime: string | null;
}

export function DateOverridesPanel({
  initialOverrides,
  inspectorId,
}: {
  initialOverrides: DateOverride[];
  inspectorId: string | null | undefined;
}) {
  const addFetcher = useFetcher<typeof action>();
  const removeFetcher = useFetcher<typeof action>();

  const [overrides, setOverrides] = useState<DateOverride[]>(initialOverrides);
  const [newDate, setNewDate] = useState("");
  // Track the last appended override id to prevent double-append on re-render
  const lastAppendedId = useRef<string | null>(null);
  // Keep a ref to the pending-removed override for rollback on failure
  const pendingRemovedRef = useRef<DateOverride | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const adding = addFetcher.state !== "idle";

  // Append the newly created override to local list when add succeeds
  useEffect(() => {
    if (
      addFetcher.state === "idle" &&
      addFetcher.data?.intent === "override-add" &&
      addFetcher.data.ok === true &&
      addFetcher.data.override
    ) {
      const created = addFetcher.data.override as DateOverride;
      if (created.id && created.id !== lastAppendedId.current) {
        lastAppendedId.current = created.id;
        setOverrides((prev) => [...prev, created]);
        setNewDate("");
      }
    }
  }, [addFetcher.state, addFetcher.data]);

  // Restore the row and show error if remove failed
  useEffect(() => {
    if (
      removeFetcher.state === "idle" &&
      removeFetcher.data?.intent === "override-remove" &&
      removeFetcher.data.ok === false
    ) {
      if (pendingRemovedRef.current) {
        setOverrides((prev) => [...prev, pendingRemovedRef.current!]);
        pendingRemovedRef.current = null;
        setRemoveError("Failed to remove date — please try again.");
      }
    } else if (removeFetcher.state === "idle" && removeFetcher.data?.ok === true) {
      pendingRemovedRef.current = null;
      setRemoveError(null);
    }
  }, [removeFetcher.state, removeFetcher.data]);

  function handleAdd() {
    if (!newDate) return;
    addFetcher.submit(
      {
        intent: "override-add",
        date: newDate,
        ...(inspectorId ? { inspectorId } : {}),
      },
      { method: "post" },
    );
  }

  function handleRemove(id: string) {
    const target = overrides.find((o) => o.id === id) ?? null;
    pendingRemovedRef.current = target;
    setRemoveError(null);
    // Optimistic removal
    setOverrides((prev) => prev.filter((o) => o.id !== id));
    removeFetcher.submit(
      { intent: "override-remove", id },
      { method: "post" },
    );
  }

  return (
    <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4">
      <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">Date overrides</h3>
      <p className="text-[12px] text-ih-fg-3">Block specific dates when you are unavailable.</p>

      {overrides.length > 0 ? (
        <div className="space-y-2">
          {overrides.map((o) => (
            <div key={o.id} className="flex items-center justify-between bg-ih-bg-muted rounded-md px-3 py-2 border border-ih-border">
              <div className="flex items-center gap-3">
                <span className="text-[13px] font-bold text-ih-fg-1">{o.date}</span>
                <span className="text-[11px] text-ih-bad-fg font-bold uppercase">Blocked</span>
              </div>
              <button
                onClick={() => handleRemove(o.id)}
                className="text-[12px] text-ih-bad-fg font-bold hover:underline"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[12px] text-ih-fg-4 italic">No date overrides set.</p>
      )}

      {removeError && (
        <p className="text-[12px] text-ih-bad-fg">{removeError}</p>
      )}

      <div className="flex items-center gap-3 pt-1">
        <input
          type="date"
          value={newDate}
          onChange={(e) => setNewDate(e.target.value)}
          className="px-3 py-1.5 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
        />
        <button
          onClick={handleAdd}
          disabled={adding || !newDate}
          title={!adding && !newDate ? "Pick a date in the field on the left first" : ""}
          className="h-8 px-3 rounded-md bg-ih-primary text-white font-bold text-[12px] hover:bg-ih-primary-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {adding ? "Adding..." : newDate ? "Block date" : "Pick a date first"}
        </button>
      </div>
    </section>
  );
}
