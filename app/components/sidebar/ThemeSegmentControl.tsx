import { SegmentedControl, type SegmentedControlOption } from "@core/shared-ui";
import { useTheme } from "~/hooks/useTheme";
import type { ColorScheme } from "~/lib/ui-prefs";
import { m } from "~/paraglide/messages";

// ─── 4-segment theme control, used in the User Menu and the mobile drawer ─────
export function ThemeSegmentControl({ className }: { className?: string }) {
  const { scheme, setColorScheme } = useTheme();
  // Built at render time (not a module const) so the labels resolve inside the
  // paraglide request scope. `field` is a high-contrast, large-type variant
  // tuned for outdoor use — surfaced with a tooltip.
  const themeOptions: SegmentedControlOption[] = [
    { value: "auto", label: m.nav_theme_auto() },
    { value: "light", label: m.nav_theme_light() },
    { value: "dark", label: m.nav_theme_dark() },
    { value: "field", label: m.nav_theme_field(), title: m.nav_theme_field_title() },
  ];
  return (
    <SegmentedControl
      options={themeOptions}
      value={scheme}
      onChange={(v) => setColorScheme(v as ColorScheme)}
      ariaLabel={m.nav_theme_aria()}
      className={className}
    />
  );
}
