import { useState } from "react";
import { Button } from "@core/shared-ui";
import type { PresenceUser, PresenceStatus } from "~/hooks/usePresence";
import { m } from "~/paraglide/messages";

interface FooterBarProps {
  connected?: boolean;
  /** FE-5 — distinguishes "still connecting" from "lost an open connection". */
  status?: PresenceStatus;
  roster?: PresenceUser[];
}

export function FooterBar({ connected = false, status, roster = [] }: FooterBarProps) {
  const effectiveStatus: PresenceStatus = status ?? (connected ? "connected" : "connecting");
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const SHORTCUTS = [
    { keys: ["1", "-", "5"], desc: m.editor_footer_shortcut_rate() },
    { keys: ["J", "/", "K"], desc: m.editor_footer_shortcut_nav() },
    { keys: ["/"], desc: m.editor_footer_shortcut_library() },
    { keys: ["P"], desc: m.editor_footer_shortcut_photo() },
    { keys: ["V"], desc: m.editor_footer_shortcut_voice() },
    { keys: ["R"], desc: m.editor_footer_shortcut_repeat() },
    { keys: ["Z"], desc: m.editor_footer_shortcut_speed() },
    { keys: ["G", "D"], desc: m.editor_footer_shortcut_next_defect() },
    { keys: ["Tab"], desc: m.editor_footer_shortcut_next_field() },
    { keys: ["Esc"], desc: m.common_cancel() },
    { keys: ["⌘", "\\"], desc: m.editor_footer_shortcut_sidebar() },
    { keys: ["?"], desc: m.editor_footer_shortcut_help() },
  ];

  return (
    <div className="hidden md:flex fixed bottom-0 inset-x-0 z-30 bg-ih-bg-card border-t border-ih-border px-4 py-1.5 items-center gap-3 text-[11px] text-ih-fg-3">
      <div className="relative">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setShortcutsOpen(!shortcutsOpen)}
          icon={<kbd className="px-1 py-0.5 bg-ih-bg-muted rounded text-[10px] font-mono border border-ih-border">?</kbd>}
        >
          {m.editor_shortcuts_label()}
        </Button>

        {shortcutsOpen && (
          <div className="absolute bottom-full left-0 mb-2 w-[320px] bg-ih-bg-card border border-ih-border rounded-lg shadow-ih-popover z-50 p-3">
            <h4 className="text-[9px] font-bold uppercase tracking-[0.2em] text-ih-fg-4 mb-2">{m.editor_shortcuts_heading()}</h4>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
              {SHORTCUTS.map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="flex gap-0.5">
                    {s.keys.map((k, j) => (
                      <kbd key={j} className="px-1 py-0.5 bg-ih-bg-muted rounded text-[10px] font-mono border border-ih-border min-w-[22px] text-center">{k}</kbd>
                    ))}
                  </span>
                  <span className="text-ih-fg-3">{s.desc}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <span className="flex-1" />

      {/* Presence roster */}
      {roster.length > 0 && (
        <div className="flex items-center gap-1 mr-2">
          {roster.slice(0, 5).map((user) => (
            <div
              key={user.userId}
              className="w-6 h-6 rounded-full bg-ih-primary text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-ih-bg-card"
              title={`${user.name}${user.focusItemId ? m.editor_footer_presence_editing({ id: user.focusItemId.slice(0, 8) }) : ''}`}
            >
              {user.name.charAt(0).toUpperCase()}
            </div>
          ))}
          {roster.length > 5 && (
            <span className="text-[10px] text-ih-fg-3 ml-1">+{roster.length - 5}</span>
          )}
        </div>
      )}

      {/* Sync status — FE-5: a fresh page shows neutral "Connecting…", not a
          scary "Disconnected"; a lost connection shows amber "Reconnecting…". */}
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded border border-ih-border font-bold text-[10px]">
        <span className={`w-1.5 h-1.5 rounded-full ${
          effectiveStatus === 'connected'
            ? 'bg-ih-ok'
            : effectiveStatus === 'reconnecting'
            ? 'bg-ih-watch'
            : 'bg-ih-fg-4 animate-pulse'
        }`} />
        {effectiveStatus === 'connected'
          ? m.editor_footer_status_connected()
          : effectiveStatus === 'reconnecting'
          ? m.editor_footer_status_reconnecting()
          : m.editor_footer_status_connecting()}
      </span>
    </div>
  );
}
