import { SegmentedControl, type SegmentedControlOption } from "@core/shared-ui";
import { useTheme } from "~/hooks/useTheme";
import type { ColorScheme } from "~/lib/ui-prefs";

// The four color schemes, in display order. `field` is a high-contrast,
// large-type variant tuned for outdoor use — surfaced with a tooltip.
const THEME_OPTIONS: SegmentedControlOption[] = [
  { value: "auto", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "field", label: "Field", title: "High-contrast large type for outdoor use" },
];

// ─── 4-segment theme control, used in the User Menu and the mobile drawer ─────
export function ThemeSegmentControl({ className }: { className?: string }) {
  const { scheme, setColorScheme } = useTheme();
  return (
    <SegmentedControl
      options={THEME_OPTIONS}
      value={scheme}
      onChange={(v) => setColorScheme(v as ColorScheme)}
      ariaLabel="Color theme"
      className={className}
    />
  );
}
