import { useEffect, useState } from "react";
import { getBrowserTimeZone, timeZoneLabel, TIMEZONE_OPTIONS } from "~/lib/timezones";
import { m } from "~/paraglide/messages";

/**
 * "Your browser timezone is X · Use this" affordance under a timezone picker.
 *
 * Mainstream field-service tools (Housecall Pro, Jobber, ServiceTitan) pre-
 * detect the viewer's zone instead of defaulting silently to UTC; this offers
 * the detected zone as a one-click choice without ever changing what the picker
 * resolves to on its own.
 *
 * SSR-safe: the browser zone is read AFTER mount (initial render is null on both
 * server and client), so there is no hydration mismatch. The line only appears
 * when the detected zone differs from what's already in effect — an actionable
 * suggestion, not decoration.
 */
export function BrowserTimezoneHint({
  effectiveValue,
  onUse,
}: {
  /** The zone currently in effect for this picker: the selected IANA id, or the
   *  value the "inherit / use company" default resolves to. When the browser
   *  zone equals this, the hint stays hidden. */
  effectiveValue: string;
  /** Adopt the detected browser zone (the parent selects + persists it). */
  onUse: (tz: string) => void;
}) {
  const [browserTz, setBrowserTz] = useState<string | null>(null);
  useEffect(() => {
    setBrowserTz(getBrowserTimeZone());
  }, []);

  // Only offer a zone the pickers can actually represent. Some runtimes report
  // a non-canonical alias (e.g. Asia/Calcutta) that has no matching <option>;
  // adopting it into an uncontrolled select would leave the value empty and
  // silently persist "inherit/clear". When the detected zone isn't in the
  // canonical list, skip the shortcut and let the user pick manually.
  if (!browserTz || browserTz === effectiveValue || !TIMEZONE_OPTIONS.includes(browserTz)) return null;

  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ih-fg-4">
      <span>{m.settings_timezone_browser_hint({ zone: timeZoneLabel(browserTz) })}</span>
      <button
        type="button"
        onClick={() => onUse(browserTz)}
        className="font-semibold text-ih-primary rounded-sm hover:underline focus:outline-none focus-visible:shadow-ih-focus"
      >
        {m.settings_timezone_browser_use()}
      </button>
    </p>
  );
}
