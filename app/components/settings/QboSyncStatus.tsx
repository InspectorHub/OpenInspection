import type { ReactNode } from "react";
import { Button, pendingProps, PENDING_CLASS, useActionLatch } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

/** "3 days ago" / "12 minutes ago" / "just now", from an epoch-SECONDS instant. */
function timeSince(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return m.settings_qbo_time_just_now();
  if (diff < 3600) return m.settings_qbo_time_minutes_ago({ minutes: Math.floor(diff / 60) });
  if (diff < 86400) return m.settings_qbo_time_hours_ago({ hours: Math.floor(diff / 3600) });
  return m.settings_qbo_time_days_ago({ days: Math.floor(diff / 86400) });
}

/** "1 item needs attention" / "N items need attention". Shared with the health card heading. */
export function attentionLabel(count: number): string {
  return count === 1 ? m.settings_qbo_attention_one() : m.settings_qbo_attention_many({ count });
}

function Stat({ value, label, href }: { value: number; label: string; href?: string }) {
  const body: ReactNode = (
    <>
      <span className="text-[24px] font-bold leading-tight tracking-tight text-ih-fg-1">{value}</span>
      <span className="text-[12.5px] text-ih-fg-3">{label}</span>
    </>
  );
  const base = "flex flex-col gap-0.5 rounded-lg border px-4 py-3.5";
  return href ? (
    <a href={href} className={`${base} border-ih-watch text-inherit no-underline hover:bg-ih-bg-muted`}>
      {body}
    </a>
  ) : (
    <div className={`${base} border-ih-border`}>{body}</div>
  );
}

/**
 * When it last ran, whether it runs by itself, the button to run it now, and
 * the three counts.
 *
 * It takes callbacks and two booleans rather than a fetcher: the route decides
 * what a sync or a toggle submits. Both controls share one latch, because they
 * are two doors to the same single in-flight action and a person pressing one
 * then the other inside a frame should still send only one request.
 *
 * The switch never flips on its own. It shows `syncEnabled` as the server last
 * reported it, so a toggle that failed does not leave the page claiming a state
 * the server does not hold.
 */
export function QboSyncStatus({
  lastSyncAt,
  openErrorCount,
  syncEnabled,
  syncing,
  busy,
  mappedCustomers,
  mappedInvoices,
  onSync,
  onToggleAuto,
}: {
  lastSyncAt: number | null;
  openErrorCount: number;
  syncEnabled: boolean;
  /** The in-flight action is the sync, which gets its own label. */
  syncing: boolean;
  /** Any QuickBooks action is in flight. */
  busy: boolean;
  mappedCustomers: number;
  mappedInvoices: number;
  onSync: () => void;
  onToggleAuto: () => void;
}) {
  const latch = useActionLatch(busy);
  const hints: string[] = [];
  if (!syncEnabled) hints.push(m.settings_qbo_auto_sync_off());
  if (!lastSyncAt) hints.push(m.settings_qbo_sync_never_hint());

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          {lastSyncAt ? (
            <p className="text-[14px] font-bold text-ih-fg-1">
              {m.settings_qbo_sync_last({ time: timeSince(lastSyncAt) })}
              {openErrorCount > 0 && (
                <>
                  {" · "}
                  <a href="#health" className="text-ih-watch-fg underline">
                    {attentionLabel(openErrorCount)}
                  </a>
                </>
              )}
            </p>
          ) : (
            <p className="text-[14px] font-bold text-ih-fg-1">{m.settings_qbo_sync_never()}</p>
          )}
          {hints.map((h) => (
            <p key={h} className="text-[12.5px] text-ih-fg-3">{h}</p>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              role="switch"
              aria-checked={syncEnabled}
              aria-labelledby="qbo-auto-sync-label"
              {...pendingProps<HTMLButtonElement>(busy, () => latch(onToggleAuto))}
              className={`relative h-6 w-10 shrink-0 rounded-full transition-colors focus:outline-none focus:shadow-ih-focus ${PENDING_CLASS} ${
                syncEnabled ? "bg-ih-primary" : "bg-ih-border-strong"
              }`}
            >
              <span
                className={`absolute top-[3px] left-[3px] h-[18px] w-[18px] rounded-full bg-ih-bg-card shadow-ih-card transition-transform ${
                  syncEnabled ? "translate-x-4" : ""
                }`}
              />
            </button>
            <span id="qbo-auto-sync-label" className="text-[13.5px] font-semibold text-ih-fg-1">
              {m.settings_qbo_auto_sync()}
            </span>
          </div>
          <Button
            variant="primary"
            pending={busy}
            aria-busy={syncing || undefined}
            onClick={() => latch(onSync)}
          >
            {syncing ? m.settings_qbo_syncing() : m.settings_qbo_sync_now()}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat value={mappedCustomers} label={m.settings_qbo_stat_contacts()} />
        <Stat value={mappedInvoices} label={m.settings_qbo_stat_invoices()} />
        {openErrorCount > 0 ? (
          <Stat value={openErrorCount} label={m.settings_qbo_stat_attention_review()} href="#health" />
        ) : (
          <Stat value={0} label={m.settings_qbo_stat_attention()} />
        )}
      </div>
    </div>
  );
}
