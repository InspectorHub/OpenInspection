import { useState, useRef, useEffect } from "react";

interface PendingItem {
  id: string;
  op: string;
  createdAt: number;
}

interface NetworkPillProps {
  online: boolean;
  pendingItems: PendingItem[];
  tier?: { id: string } | null;
  onRetryOne?: (id: string) => void;
  onSyncNow?: () => void;
}

export function NetworkPill({ online, pendingItems, tier, onRetryOne, onSyncNow }: NetworkPillProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setPopoverOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const dotClass = online
    ? pendingItems.length > 0 ? "bg-amber-400 animate-pulse" : "bg-ih-ok-bg0"
    : "bg-slate-400";
  const label = !online ? "Offline" : pendingItems.length > 0 ? "Syncing" : "Online";

  return (
    <div className="fixed top-4 right-4 z-40" ref={ref}>
      <button type="button" onClick={() => setPopoverOpen(!popoverOpen)} className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-ih-bg-card shadow-md ring-1 ring-ih-border text-xs font-bold text-ih-fg-2 hover:bg-ih-bg-muted">
        <span className={`w-2 h-2 rounded-full ${dotClass}`} />
        <span>{label}</span>
      </button>

      {popoverOpen && (
        <div className="absolute right-0 top-full mt-2 w-72 bg-ih-bg-card rounded-xl shadow-xl ring-1 ring-slate-200 dark:ring-slate-700 p-4 text-sm">
          <div className="font-semibold text-ih-fg-1 mb-2">
            {!online ? "Working offline" : pendingItems.length > 0 ? `Syncing ${pendingItems.length} change${pendingItems.length === 1 ? "" : "s"}` : "All synced"}
          </div>
          {online && pendingItems.length === 0 && (
            <div className="text-xs text-ih-fg-3">Your work auto-saves to this device and uploads automatically.</div>
          )}
          {!online && (
            <div className="text-xs text-ih-fg-3 mb-2">Your work is being saved on this device. It will upload as soon as you are back online.</div>
          )}
          {!online && tier?.id === "C" && (
            <div className="text-xs text-ih-watch-fg bg-ih-watch-bg rounded-md p-2 mb-2">On iOS Safari you can store about 75 photos per inspection while offline. For unlimited offline storage, install this app: Share &gt; Add to Home Screen.</div>
          )}
          {!online && tier?.id === "D" && (
            <div className="text-xs text-ih-watch-fg bg-ih-watch-bg rounded-md p-2 mb-2">Your iOS version stores about 30 photos per inspection while offline. Updating iOS will lift this limit.</div>
          )}
          {online && tier?.id === "B" && (
            <div className="text-xs text-ih-fg-3 mb-2">Tip: install this app from your browser menu so the device keeps your data permanently.</div>
          )}
          {pendingItems.length > 0 && (
            <ul className="space-y-2 max-h-60 overflow-y-auto mt-2 border-t border-slate-100 dark:border-slate-700 pt-2">
              {pendingItems.map((it) => (
                <li key={it.id} className="flex items-start justify-between gap-2 text-xs">
                  <span>{it.op} · {new Date(it.createdAt).toLocaleTimeString()}</span>
                  <button onClick={() => onRetryOne?.(it.id)} className="text-indigo-600 hover:underline">Retry</button>
                </li>
              ))}
            </ul>
          )}
          {pendingItems.length > 0 && (
            <button onClick={onSyncNow} className="mt-3 w-full h-9 px-4 rounded-lg bg-ih-primary text-white text-sm font-semibold hover:bg-ih-primary-600 transition-all">Sync now</button>
          )}
        </div>
      )}
    </div>
  );
}
