type BannerKind = "clean" | "conflicts" | "reconnecting";

interface ReconnectBannerProps {
  kind: BannerKind;
  visible: boolean;
  mergedCount?: number;
  conflictCount?: number;
  queuedCount?: number;
  onDismiss?: () => void;
  onReviewConflicts?: () => void;
}

export function ReconnectBanner({ kind, visible, mergedCount = 0, conflictCount = 0, queuedCount = 0, onDismiss, onReviewConflicts }: ReconnectBannerProps) {
  if (!visible) return null;

  if (kind === "clean") {
    return (
      <div className="sticky top-0 inset-x-0 z-40 border-b px-4 py-2 text-sm flex items-center justify-between gap-3" style={{ background: "var(--ih-status-ok-bg)", borderColor: "var(--ih-status-ok)", color: "var(--ih-status-ok-fg)" }} role="alert">
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-full flex items-center justify-center" style={{ background: "var(--ih-status-ok)" }}>
            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
          </span>
          <span><strong>Reconnected</strong> · {mergedCount} changes auto-merged · You are back in sync.</span>
        </div>
        <button type="button" onClick={onDismiss} className="text-ih-ok-fg hover:text-emerald-900" aria-label="Dismiss">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>
    );
  }

  if (kind === "conflicts") {
    return (
      <div className="sticky top-0 inset-x-0 z-40 border-b px-4 py-2 text-sm flex items-center justify-between gap-3" style={{ background: "var(--ih-status-bad-bg)", borderColor: "var(--ih-status-bad)", color: "var(--ih-status-bad-fg)" }} role="alert">
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-full flex items-center justify-center" style={{ background: "var(--ih-status-bad)" }}>
            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 9v2m0 4h.01" /></svg>
          </span>
          <span><strong>Reconnected</strong> · {mergedCount} auto-merged · {conflictCount} conflicts to resolve</span>
        </div>
        <button type="button" className="ih-btn ih-btn--sm" style={{ background: "var(--ih-status-bad)", color: "white" }} onClick={onReviewConflicts}>Review</button>
      </div>
    );
  }

  return (
    <div className="sticky top-0 inset-x-0 z-40 bg-amber-100 border-b border-ih-watch px-4 py-2 text-sm text-amber-900 flex items-center gap-3" role="alert">
      <span className="w-4 h-4 rounded-full bg-ih-watch-bg0 animate-pulse" />
      <span>Reconnecting... {queuedCount} queued changes syncing</span>
    </div>
  );
}
