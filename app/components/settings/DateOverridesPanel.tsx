import { useState } from "react";
import { Link } from "react-router";
import { Button } from "@core/shared-ui";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import { ActionFailureAlert } from "~/components/ActionFailureAlert";
import { useGuardedSubmit } from "~/hooks/useGuardedSubmit";
import { formatDate } from "~/lib/format";
import { useDisplayLocale } from "~/hooks/useSessionContext";
import { m } from "~/paraglide/messages";

interface DateOverride {
  id: string;
  date: string;
  isAvailable: boolean;
  startTime: string | null;
  endTime: string | null;
  /** The calendar provider the row was synced from; null for a hand-entered (manual) override. */
  source?: "google" | "apple" | null;
}

/** What removing this row changes, in words that match it: extra hours, a block over part of the day, or the whole day. */
function removeMessage(o: DateOverride, date: string): string {
  if (o.isAvailable) return m.settings_dateoverrides_remove_message_extra({ date });
  if (o.startTime && o.endTime) return m.settings_dateoverrides_remove_message_window({ date, start: o.startTime, end: o.endTime });
  return m.settings_dateoverrides_remove_message_block({ date });
}

/**
 * Legacy / Google-synced availability overrides, each removable after a
 * confirmation (nothing else can clear one). New time off is created via
 * Calendar → Block time (`calendar_blocks`).
 */
export function DateOverridesPanel({
  initialOverrides,
}: {
  initialOverrides: DateOverride[];
  /** Kept for call-site compatibility; adding is no longer offered here. */
  inspectorId?: string | null;
}) {
  const locale = useDisplayLocale();
  const [pending, setPending] = useState<DateOverride | null>(null);
  // Posts to this route's action (`override-remove`), which relays DELETE /api/availability/overrides/:id.
  const { fetcher, submit, busy } = useGuardedSubmit<{ ok?: boolean; intent?: string; message?: string | null }>();
  if (initialOverrides.length === 0 && !pending) return null;

  return (
    <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4">
      <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">
        {m.settings_dateoverrides_heading()}
      </h3>
      <p className="text-[12px] text-ih-fg-3">
        {m.settings_dateoverrides_use_prefix()}{" "}
        <Link to="/calendar" className="text-ih-primary-text font-semibold hover:underline">
          {m.settings_dateoverrides_link()}
        </Link>{" "}
        {m.settings_dateoverrides_use_suffix()}
      </p>

      <div className="space-y-2">
        {initialOverrides.map((o) => (
          <div
            key={o.id}
            className="flex items-center justify-between bg-ih-bg-muted rounded-md px-3 py-2 border border-ih-border"
          >
            <div className="flex items-center gap-3">
              <span className="text-[13px] font-bold text-ih-fg-1">{formatDate(o.date, { locale, timeZone: "UTC" })}</span>
              <span className="text-[11px] text-ih-bad-fg font-bold uppercase">
                {o.isAvailable ? m.settings_dateoverrides_extra_hours() : m.settings_closed_policy_blocked()}
              </span>
              {o.startTime && o.endTime && (
                <span className="text-[12px] text-ih-fg-3">
                  {o.startTime}–{o.endTime}
                </span>
              )}
            </div>
            {!o.source ? (
              <Button variant="danger-link" size="sm" onClick={() => setPending(o)}>{m.common_remove()}</Button>
            ) : (
              // Synced rows belong to the calendar connection: the next sync brings them back and the API refuses a removal.
              <span className="text-[12px] text-ih-fg-3">{m.settings_dateoverrides_synced_note({ provider: o.source === "google" ? "Google" : "Apple" })}</span>
            )}
          </div>
        ))}
      </div>
      <ActionFailureAlert result={fetcher.data} intents={["override-remove"]} busy={busy}>{fetcher.data?.message ?? m.settings_dateoverrides_remove_failed()}</ActionFailureAlert>
      <ConfirmDialog
        open={pending !== null}
        title={m.settings_dateoverrides_remove_title()}
        message={pending ? removeMessage(pending, formatDate(pending.date, { locale, timeZone: "UTC" })) : ""}
        confirmLabel={m.common_remove()}
        busy={busy}
        onConfirm={() => {
          if (pending && submit({ intent: "override-remove", id: pending.id }, { method: "post" })) setPending(null);
        }}
        onCancel={() => setPending(null)}
      />
    </section>
  );
}
