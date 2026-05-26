import { useEffect, useRef } from "react";

interface RosterMember {
  userId: string;
  name?: string;
  role: "inspector" | "observer";
  focusItemId?: string | null;
}

interface RosterPopoverProps {
  open: boolean;
  roster: RosterMember[];
  onClose: () => void;
  onInvitePermanent?: () => void;
  onInviteGuest?: () => void;
}

export function RosterPopover({ open, roster, onClose, onInvitePermanent, onInviteGuest }: RosterPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (open) window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 bg-slate-900/30 flex items-start justify-end p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} role="dialog" aria-modal="true" aria-label="Roster">
      <div className="ih-card w-80 max-w-full p-4 bg-white" ref={ref}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="ih-eyebrow">Inspectors on this inspection</h3>
          <button type="button" className="ih-btn ih-btn--sm ih-btn--ghost" onClick={onClose} aria-label="Close">&times;</button>
        </div>

        <ul className="space-y-2">
          {roster.map((u) => (
            <li key={u.userId} className="flex items-center gap-3">
              <div className="relative">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${u.role === "observer" ? "bg-amber-100 text-ih-watch-fg" : "bg-slate-300 text-slate-700"}`}>
                  {u.role === "observer" ? "👁" : (u.name || u.userId || "?").slice(0, 2).toUpperCase()}
                </div>
                <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-white ${u.role === "observer" ? "bg-amber-400" : "bg-ih-ok-bg0"}`} aria-hidden="true" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{u.name || u.userId}</div>
                {u.focusItemId && <div className="ih-meta">editing {u.focusItemId}</div>}
                {u.role === "observer" && <div className="ih-meta">Observer (read-only)</div>}
              </div>
            </li>
          ))}
          {roster.length === 0 && (
            <li className="ih-meta text-center py-4">Nobody else is on this inspection right now.</li>
          )}
        </ul>

        <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-700 flex gap-2">
          <button type="button" className="ih-btn ih-btn--sm ih-btn--secondary" onClick={onInvitePermanent} title="Send an email invite to a new permanent inspector">Add inspector</button>
          <button type="button" className="ih-btn ih-btn--sm ih-btn--secondary" onClick={onInviteGuest} title="Generate a one-time guest invite link">Invite guest</button>
        </div>
      </div>
    </div>
  );
}
