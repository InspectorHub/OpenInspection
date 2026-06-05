import { useState, useRef, useEffect } from "react";

// Tier identifier drives storage-warning copy for constrained iOS environments.
interface Tier {
  id: string;
}

interface NetworkPillProps {
  online: boolean;
  /** Count of queue entries waiting to be synced (pending state). */
  pendingCount: number;
  /** Count of queue entries that permanently failed (MAX_ATTEMPTS exhausted). */
  failedCount: number;
  /** Whether a replay run is currently in progress. */
  syncing?: boolean;
  tier?: Tier | null;
  /** Called when the user clicks "Sync now". Receives the ReplayResult via the
   * returned promise so the caller can surface post-replay toasts. */
  onSyncNow?: () => void;
}

export function NetworkPill({
  online,
  pendingCount,
  failedCount,
  syncing = false,
  tier,
  onSyncNow,
}: NetworkPillProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close popover when clicking outside.
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setPopoverOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const totalQueued = pendingCount + failedCount;

  // Dot color: bad=red when there are failed entries; watch=amber while
  // pending or actively syncing; ok=green when fully caught up; fg-4=grey offline.
  const dotClass = !online
    ? "bg-ih-fg-4"
    : failedCount > 0
      ? "bg-ih-bad"
      : pendingCount > 0 || syncing
        ? "bg-ih-watch animate-pulse"
        : "bg-ih-ok";

  const label = !online
    ? "Offline"
    : syncing
      ? "Syncing…"
      : failedCount > 0
        ? "Sync error"
        : pendingCount > 0
          ? "Pending"
          : "Online";

  return (
    <div className="fixed top-4 right-4 z-40" ref={ref}>
      <button
        type="button"
        onClick={() => setPopoverOpen(!popoverOpen)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-ih-bg-card shadow-ih-card ring-1 ring-ih-border text-xs font-bold text-ih-fg-2 hover:bg-ih-bg-muted"
      >
        <span className={`w-2 h-2 rounded-full ${dotClass}`} />
        <span>{label}</span>
      </button>

      {popoverOpen && (
        <div className="absolute right-0 top-full mt-2 w-72 bg-ih-bg-card rounded-xl shadow-ih-popover ring-1 ring-ih-border p-4 text-sm">
          {/* Popover heading */}
          <div className="font-semibold text-ih-fg-1 mb-2">
            {!online
              ? "Working offline"
              : syncing
                ? "Syncing…"
                : totalQueued > 0
                  ? `${totalQueued} change${totalQueued === 1 ? "" : "s"} waiting`
                  : "All synced"}
          </div>

          {/* All-clear state */}
          {online && !syncing && totalQueued === 0 && (
            <div className="text-xs text-ih-fg-3">
              Your work auto-saves to this device and uploads automatically.
            </div>
          )}

          {/* Offline descriptive copy */}
          {!online && (
            <div className="text-xs text-ih-fg-3 mb-2">
              Saved on this device — will sync when you&apos;re back online.
            </div>
          )}

          {/* iOS storage-limit advisory banners */}
          {!online && tier?.id === "C" && (
            <div className="text-xs text-ih-watch-fg bg-ih-watch-bg rounded-md p-2 mb-2">
              On iOS Safari you can store about 75 photos per inspection while
              offline. For unlimited offline storage, install this app: Share
              &gt; Add to Home Screen.
            </div>
          )}
          {!online && tier?.id === "D" && (
            <div className="text-xs text-ih-watch-fg bg-ih-watch-bg rounded-md p-2 mb-2">
              Your iOS version stores about 30 photos per inspection while
              offline. Updating iOS will lift this limit.
            </div>
          )}

          {/* Install-prompt for PWA tier B */}
          {online && tier?.id === "B" && (
            <div className="text-xs text-ih-fg-3 mb-2">
              Tip: install this app from your browser menu so the device keeps
              your data permanently.
            </div>
          )}

          {/* Pending / failed count lines */}
          {(pendingCount > 0 || failedCount > 0) && (
            <div className="mt-2 space-y-1 border-t border-ih-border pt-2 text-xs">
              {pendingCount > 0 && (
                <div className="flex items-center justify-between text-ih-fg-2">
                  <span>Pending</span>
                  <span className="font-bold tabular-nums">{pendingCount}</span>
                </div>
              )}
              {/* Failed count shown in error tone when > 0 */}
              {failedCount > 0 && (
                <div className="flex items-center justify-between text-ih-bad-fg">
                  <span>Failed (retry to recover)</span>
                  <span className="font-bold tabular-nums">{failedCount}</span>
                </div>
              )}
            </div>
          )}

          {/* Sync now button — visible whenever there is something to sync */}
          {(totalQueued > 0 || syncing) && online && (
            <button
              onClick={() => {
                onSyncNow?.();
                setPopoverOpen(false);
              }}
              disabled={syncing}
              className="mt-3 w-full h-9 px-4 rounded-lg bg-ih-primary text-white text-sm font-semibold hover:bg-ih-primary-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {syncing ? "Syncing…" : "Sync now"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
