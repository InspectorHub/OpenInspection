import { Link } from "react-router";

interface DateOverride {
  id: string;
  date: string;
  isAvailable: boolean;
  startTime: string | null;
  endTime: string | null;
}

/**
 * Read-only list of legacy / Google-synced availability overrides.
 * New time off is created via Calendar → Block time (`calendar_blocks`).
 */
export function DateOverridesPanel({
  initialOverrides,
}: {
  initialOverrides: DateOverride[];
  /** Kept for call-site compatibility; add/remove is no longer offered here. */
  inspectorId?: string | null;
}) {
  if (initialOverrides.length === 0) return null;

  return (
    <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4">
      <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">
        Synced & legacy
      </h3>
      <p className="text-[12px] text-ih-fg-3">
        Use{" "}
        <Link to="/calendar" className="text-ih-primary font-semibold hover:underline">
          Calendar → Block time
        </Link>{" "}
        for new time off. This list shows synced Google busy days and older date blocks.
      </p>

      <div className="space-y-2">
        {initialOverrides.map((o) => (
          <div
            key={o.id}
            className="flex items-center justify-between bg-ih-bg-muted rounded-md px-3 py-2 border border-ih-border"
          >
            <div className="flex items-center gap-3">
              <span className="text-[13px] font-bold text-ih-fg-1">{o.date}</span>
              <span className="text-[11px] text-ih-bad-fg font-bold uppercase">
                {o.isAvailable ? "Extra hours" : "Blocked"}
              </span>
              {o.startTime && o.endTime && (
                <span className="text-[12px] text-ih-fg-3">
                  {o.startTime}–{o.endTime}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
