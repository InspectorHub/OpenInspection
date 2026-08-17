import { m } from "~/paraglide/messages";
import { QboBooksHealth, type QboDiscrepancy } from "~/components/settings/QboBooksHealth";
import type { QBOConnectionStatus } from "../../../server/services/qbo/api-base";

/** "3 hours ago" / "just now" / "never", from an epoch-SECONDS instant. */
function timeSince(ts: number | null | undefined): string {
  if (!ts) return m.settings_qbo_time_never();
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return m.settings_qbo_time_just_now();
  if (diff < 3600) return m.settings_qbo_time_minutes_ago({ minutes: Math.floor(diff / 60) });
  return m.settings_qbo_time_hours_ago({ hours: Math.floor(diff / 3600) });
}

/**
 * Everything the page shows once a QuickBooks company is connected: which
 * company and when it last synced, the three actions, and the books-health
 * cards below them.
 *
 * Split out of the route because the route had grown past the 400-line ceiling,
 * and this is the seam the file already used — `QboConnectCard`,
 * `QboCredentialsForm` and `QboBooksHealth` were extracted the same way. The
 * route keeps the loader, the action, and the state the actions mutate; this
 * keeps the markup.
 *
 * It takes callbacks rather than a fetcher: whether an action is permitted and
 * what it submits are the route's business, and a component that submitted on
 * its own would be a second place to keep those decisions right.
 */
export function QboConnectionPanel({
  status,
  discrepancies,
  busy,
  syncing,
  dismissingId,
  onSync,
  onTogglePause,
  onRequestDisconnect,
  onDismissError,
}: {
  status: QBOConnectionStatus;
  discrepancies: QboDiscrepancy[];
  /** Any QBO action is in flight — every button disables together. */
  busy: boolean;
  /** The in-flight action is specifically the sync, which gets its own label. */
  syncing: boolean;
  dismissingId: string | null;
  onSync: () => void;
  onTogglePause: () => void;
  /** Opens the confirmation. Disconnecting is not a one-click action. */
  onRequestDisconnect: () => void;
  onDismissError: (id: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="bg-ih-bg-card border border-ih-border rounded-lg p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="font-bold text-[14px] text-ih-fg-1">
              {status.companyName ?? m.settings_qbo_connected_fallback()}
            </p>
            <p className="text-[12px] text-ih-fg-3 mt-0.5">
              {m.settings_qbo_last_synced({ time: timeSince(status.lastSyncAt) })}
            </p>
          </div>
          <span
            className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full ${
              status.syncEnabled ? "bg-ih-ok-bg text-ih-ok-fg" : "bg-ih-bg-muted text-ih-fg-3"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${status.syncEnabled ? "bg-ih-ok" : "bg-ih-fg-4"}`}
            />
            {status.syncEnabled ? m.settings_qbo_status_active() : m.settings_qbo_status_paused()}
          </span>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={onSync}
            disabled={busy}
            aria-busy={syncing || undefined}
            className="px-4 py-2 text-[12px] font-bold bg-ih-primary-tint text-ih-primary-text rounded-md hover:bg-ih-primary-tint transition-colors disabled:opacity-50"
          >
            {syncing ? m.settings_qbo_syncing() : m.settings_qbo_sync_now()}
          </button>
          <button
            onClick={onTogglePause}
            disabled={busy}
            aria-busy={busy || undefined}
            className="px-4 py-2 text-[12px] font-bold bg-ih-bg-muted text-ih-fg-2 rounded-md hover:bg-ih-bg-muted transition-colors disabled:opacity-50"
          >
            {status.syncEnabled ? m.settings_qbo_pause_sync() : m.settings_qbo_resume_sync()}
          </button>
          <button
            onClick={onRequestDisconnect}
            disabled={busy}
            aria-busy={busy || undefined}
            className="px-4 py-2 text-[12px] font-bold text-ih-bad-fg hover:bg-ih-bad-bg rounded-md transition-colors disabled:opacity-50"
          >
            {m.settings_qbo_disconnect()}
          </button>
        </div>
      </div>

      {/* Failed pushes, disagreements and what is never sent — see
          QboBooksHealth for why a discrepancy shows both figures. */}
      <QboBooksHealth
        openErrors={status.openErrors ?? []}
        discrepancies={discrepancies}
        heldDepositCount={status.heldDepositCount ?? 0}
        onDismissError={onDismissError}
        dismissingId={dismissingId}
      />
    </div>
  );
}
