import { useEffect, useRef } from "react";
import { Button } from "@core/shared-ui";

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
}

export function RosterPopover({ open, roster, onClose, onInvitePermanent }: RosterPopoverProps) {
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
    <div className="fixed inset-0 z-40 bg-[rgba(15,23,42,0.3)] flex items-start justify-end p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} role="dialog" aria-modal="true" aria-label="Roster">
      <div className="ih-card w-80 max-w-full p-4 bg-ih-bg-card" ref={ref}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="ih-eyebrow">Inspectors on this inspection</h3>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">&times;</Button>
        </div>

        <ul className="space-y-2">
          {roster.map((u) => (
            <li key={u.userId} className="flex items-center gap-3">
              <div className="relative">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${u.role === "observer" ? "bg-ih-watch-bg text-ih-watch-fg" : "bg-ih-bg-muted text-ih-fg-2"}`}>
                  {u.role === "observer" ? "👁" : (u.name || u.userId || "?").slice(0, 2).toUpperCase()}
                </div>
                <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-ih-bg-card ${u.role === "observer" ? "bg-ih-watch" : "bg-ih-ok"}`} aria-hidden="true" />
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

        <div className="mt-4 pt-3 border-t border-ih-border flex gap-2">
          <Button variant="secondary" size="sm" onClick={onInvitePermanent} title="Send an email invite to a new permanent inspector">Add inspector</Button>
        </div>
      </div>
    </div>
  );
}
