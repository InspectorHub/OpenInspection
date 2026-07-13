import { useState, useEffect } from "react";
import { MenuItem } from "@core/shared-ui";

interface DockTile {
  id: string;
  label: string;
  iconPath: string;
  hotkey?: string;
}

const TILES: DockTile[] = [
  { id: "speed-mode", label: "Speed mode", iconPath: "M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z", hotkey: "Z" },
  { id: "burst-camera", label: "Burst camera", iconPath: "M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316zM16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" },
  { id: "photo-studio", label: "Photo studio", iconPath: "M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42" },
  { id: "shortcuts", label: "Shortcuts", iconPath: "M6 6.878V6a2.25 2.25 0 012.25-2.25h7.5A2.25 2.25 0 0118 6v.878m-12 0c.235-.083.487-.128.75-.128h10.5c.263 0 .515.045.75.128m-12 0A2.25 2.25 0 004.5 9v.878m13.5-3A2.25 2.25 0 0119.5 9v.878m0 0a2.246 2.246 0 00-.75-.128H5.25c-.263 0-.515.045-.75.128m15 0A2.25 2.25 0 0121 12v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6c0-.98.626-1.813 1.5-2.122", hotkey: "?" },
];

interface InspectorToolsDockProps {
  onToggleSpeedMode?: () => void;
  onBurstCamera?: (activeItemId?: string) => void;
  onPhotoStudio?: () => void;
  onToggleCheatsheet?: () => void;
  activeItemId?: string;
  hidden?: boolean;
}

export function InspectorToolsDock({
  onToggleSpeedMode,
  onBurstCamera,
  onPhotoStudio,
  onToggleCheatsheet,
  activeItemId,
  hidden,
}: InspectorToolsDockProps) {
  const [dockOpen, setDockOpen] = useState(false);

  // Escape closes the dock menu (parity with every Modal/Drawer, which close on
  // Escape via useDialogBehavior). Without this the menu could only be dismissed
  // by clicking its click-outside backdrop — and that full-screen backdrop
  // intercepts pointer events over the rest of the editor until it closes.
  useEffect(() => {
    if (!dockOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDockOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dockOpen]);

  if (hidden) return null;

  const handlers: Record<string, () => void> = {
    "speed-mode": () => { onToggleSpeedMode?.(); setDockOpen(false); },
    "burst-camera": () => { onBurstCamera?.(activeItemId); setDockOpen(false); },
    "photo-studio": () => { onPhotoStudio?.(); setDockOpen(false); },
    shortcuts: () => { onToggleCheatsheet?.(); setDockOpen(false); },
  };

  return (
    <div className="hidden md:block fixed bottom-6 right-6 z-40">
      {dockOpen && <div className="fixed inset-0 z-[-1]" onClick={() => setDockOpen(false)} aria-hidden="true" />}
      {dockOpen && (
        <div className="absolute bottom-16 right-0 mb-2 ih-card p-2 min-w-[200px] bg-ih-bg-card border border-ih-border rounded-lg shadow-ih-popover" role="menu" aria-label="Inspector tools">
          {TILES.map((t) => (
            <MenuItem
              key={t.id}
              icon={
                <svg aria-hidden="true" className="w-5 h-5 text-ih-fg-3" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                  <path d={t.iconPath} />
                </svg>
              }
              onClick={handlers[t.id]}
              className="gap-3 py-2 rounded"
            >
              <span className="flex-1 text-left text-sm">{t.label}</span>
              {t.hotkey && <span className="ih-kbd text-[11px] text-ih-fg-4 bg-ih-bg-muted px-1.5 py-0.5 rounded font-mono">{t.hotkey}</span>}
            </MenuItem>
          ))}
        </div>
      )}
      {/* DS exception: intentional gradient FAB */}
      <button
        type="button"
        className="w-14 h-14 rounded-full bg-gradient-to-br from-ih-primary to-ih-primary-600 shadow-ih-popover flex items-center justify-center text-white active:scale-95 transition-transform"
        onClick={() => setDockOpen(!dockOpen)}
        aria-label={dockOpen ? "Close inspector tools" : "Open inspector tools"}
        aria-expanded={dockOpen}
      >
        <svg aria-hidden="true" className="w-6 h-6 transition-transform duration-150" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" style={dockOpen ? { transform: "rotate(45deg)" } : undefined}>
          <path d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
      </button>
    </div>
  );
}
