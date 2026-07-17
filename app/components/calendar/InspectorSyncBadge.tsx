import { Pill, type PillTone } from "@core/shared-ui";
import { formatRelativeTime } from "~/lib/format";
import { m } from "~/paraglide/messages";

export type SyncBadgeState = "connected" | "stale" | "not-connected";

const STALE_AFTER_MS = 86_400_000;

/**
 * Pure so the badge stays testable without freezing the clock: `now` is passed
 * in rather than read from Date.now().
 */
export function syncBadgeState(
  connected: boolean,
  lastSyncAt: number | null,
  now: number,
): SyncBadgeState {
  if (!connected) return "not-connected";
  // Connected but never synced: there is no freshness to vouch for.
  if (lastSyncAt === null) return "stale";
  // Skew between the worker clock and the browser can put lastSyncAt slightly
  // ahead of now; that is a fresh sync, not a stale one.
  return now - lastSyncAt > STALE_AFTER_MS ? "stale" : "connected";
}

const TONE: Record<SyncBadgeState, PillTone> = {
  connected: "sat",
  stale: "warning",
  "not-connected": "neutral",
};

function stateLabel(state: SyncBadgeState): string {
  const labels: Record<SyncBadgeState, string> = {
    connected: m.calendar_sync_connected(),
    stale: m.calendar_sync_stale(),
    "not-connected": m.calendar_sync_not_connected(),
  };
  return labels[state];
}

/** Google-sync freshness for one inspector, shown beside their Team chip. */
export function InspectorSyncBadge({
  connected,
  lastSyncAt,
  now = Date.now(),
  locale,
}: {
  connected: boolean;
  lastSyncAt: number | null;
  now?: number;
  locale: string;
}) {
  const state = syncBadgeState(connected, lastSyncAt, now);
  const status = stateLabel(state);
  // Only claim a sync time when one actually happened.
  const relative = connected && lastSyncAt !== null
    ? formatRelativeTime(lastSyncAt, { locale, now })
    : "";
  const title = relative ? `${status} · ${relative}` : status;

  return (
    <span data-sync-state={state} title={title}>
      <Pill tone={TONE[state]} dot>
        <span className="sr-only">{title}</span>
      </Pill>
    </span>
  );
}
