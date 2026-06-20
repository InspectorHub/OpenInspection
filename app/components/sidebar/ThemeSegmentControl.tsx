import { useTheme } from "~/hooks/useTheme";

// ─── Inline 3-segment theme control used inside the User Menu ─────────────────
export function ThemeSegmentControl() {
  const { scheme, setColorScheme } = useTheme();
  return (
    <div className="flex gap-1 p-1 bg-ih-bg-muted rounded-[6px]">
      {(["auto", "light", "dark", "field"] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          onClick={() => setColorScheme(mode)}
          className={`flex-1 py-1 rounded-[4px] text-[11px] font-bold capitalize transition-colors focus:outline-none focus:shadow-ih-focus ${
            scheme === mode
              ? "bg-ih-bg-card text-ih-primary shadow-ih-card"
              : "text-ih-fg-3 hover:text-ih-fg-1"
          }`}
          aria-pressed={scheme === mode}
          title={mode === "field" ? "High-contrast large type for outdoor use" : undefined}
        >
          {mode === "auto" ? "Auto" : mode === "light" ? "Light" : mode === "dark" ? "Dark" : "Field"}
        </button>
      ))}
    </div>
  );
}
