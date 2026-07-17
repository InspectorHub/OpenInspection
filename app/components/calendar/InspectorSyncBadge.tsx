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
  // Only claim a sync time when one actually happened. The tooltip carries the
  // verbose form ("1 hour ago"); the chip shows the narrow form ("1 hr. ago")
  // so a row of inspectors stays scannable.
  const synced = connected && lastSyncAt !== null;
  const relativeLong = synced ? formatRelativeTime(lastSyncAt, { locale, now }) : "";
  const relativeShort = synced
    ? formatRelativeTime(lastSyncAt, { locale, now, style: "narrow" })
    : "";
  const title = relativeLong ? `${status} · ${relativeLong}` : status;

  // Quiet when healthy, loud when there is a problem. Connected shows just the
  // freshness — the green dot already says "synced", so the word is redundant.
  // Stale/missing spell out the problem as visible text rather than hiding it in
  // a hover tooltip. A connected-but-never-synced calendar is stale, but reads
  // as "Never synced": there is no earlier sync for it to be out of date from.
  const visibleLabel =
    state === "connected"
      ? relativeShort
      : state === "stale" && connected && lastSyncAt === null
        ? m.calendar_sync_never()
        : state === "stale"
          ? m.calendar_sync_stale_short()
          : m.calendar_sync_not_connected_short();

  return (
    <span data-sync-state={state} title={title} className="inline-flex items-center">
      <Pill tone={TONE[state]} dot>
        <span data-sync-label aria-hidden="true" className="text-[11px] font-medium">
          {visibleLabel}
        </span>
        <span className="sr-only">{title}</span>
      </Pill>
    </span>
  );
}
