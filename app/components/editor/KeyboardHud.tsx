import { useEffect } from "react";
import { IconButton } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

interface ShortcutColumn {
  title: string;
  rows: { key: string; label: string }[];
}

export function KeyboardHud({ onClose }: { onClose: () => void }) {
  const COLUMNS: ShortcutColumn[] = [
    { title: m.editor_hud_col_navigate(), rows: [
      { key: "Up/Down", label: m.editor_hud_nav_prev_next() },
      { key: "Enter",   label: m.editor_hud_nav_next() },
      { key: "Shift+Enter", label: m.editor_hud_nav_prev() },
      { key: "GS",   label: m.editor_hud_nav_section() },
      { key: "Cmd+K", label: m.editor_hud_nav_palette() },
      { key: "Ctrl+/", label: m.editor_hud_nav_palette_win() },
    ]},
    { title: m.editor_hud_col_rating(), rows: [
      { key: "1", label: m.editor_hud_rate_satisfactory() },
      { key: "2", label: m.editor_hud_rate_monitor() },
      { key: "3", label: m.editor_hud_rate_defect() },
      { key: "4", label: m.editor_hud_rate_not_inspected() },
      { key: "5", label: m.editor_hud_rate_not_present() },
      { key: "0", label: m.editor_hud_rate_clear() },
      { key: "N", label: m.editor_hud_rate_na() },
    ]},
    { title: m.editor_hud_col_content(), rows: [
      { key: "/", label: m.editor_hud_content_library() },
      { key: ";", label: m.editor_hud_content_snippet() },
      { key: "P", label: m.editor_item_add_photo() },
      { key: "T", label: m.editor_hud_content_tag() },
      { key: "Cmd+D", label: m.editor_hud_content_save_snippet() },
    ]},
    { title: m.editor_hud_col_view(), rows: [
      { key: "Cmd+1", label: m.editor_hud_view_three_pane() },
      { key: "Cmd+2", label: m.editor_hud_view_focus() },
      { key: "Cmd+3", label: m.editor_header_preview() },
      { key: "Cmd+S", label: m.common_save() },
      { key: "Cmd+Shift+P", label: m.editor_header_publish() },
    ]},
  ];
  // The editor mounts this only while the cheatsheet is toggled on — that state
  // lives in the parent, and the `?` hotkey (useKeyboard) flips it — so the
  // overlay renders as soon as it mounts and closes via `onClose` (Esc, backdrop
  // click, or another `?`). It previously kept a private `open` state that
  // started false, so it mounted but rendered nothing: the `?` HUD never
  // appeared after the Alpine→RR migration.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="hidden md:flex fixed inset-0 z-[9999] items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={m.editor_shortcuts_heading()}>
      <div className="absolute inset-0 bg-ih-backdrop" onClick={onClose} />
      <div className="relative bg-ih-bg-card rounded-lg shadow-ih-popover border border-ih-border max-w-4xl w-full max-h-[85vh] overflow-y-auto">
        <header className="px-6 py-4 border-b border-ih-border flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-ih-fg-1">{m.editor_shortcuts_heading()}</h2>
            <p className="text-xs text-ih-fg-3 mt-0.5">{m.editor_hud_press()}<kbd className="px-1.5 py-0.5 bg-ih-bg-muted border border-ih-border rounded text-[10px] font-mono">?</kbd>{m.editor_hud_toggle()}<kbd className="px-1.5 py-0.5 bg-ih-bg-muted border border-ih-border rounded text-[10px] font-mono">Esc</kbd>{m.editor_hud_close()}</p>
          </div>
          <IconButton onClick={onClose} aria-label={m.common_close()} size="sm">&times;</IconButton>
        </header>
        <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-ih-fg-4 mb-3">{col.title}</h3>
              <ul className="space-y-2">
                {col.rows.map((row) => (
                  <li key={row.key} className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-ih-fg-2 leading-tight">{row.label}</span>
                    <kbd className="shrink-0 px-2 py-0.5 bg-ih-bg-muted border border-ih-border rounded text-[11px] font-mono text-ih-fg-2 min-w-[28px] text-center">{row.key}</kbd>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <footer className="px-6 py-3 border-t border-ih-border text-[10px] text-ih-fg-4 italic">
          {m.editor_hud_footer()}
        </footer>
      </div>
    </div>
  );
}
