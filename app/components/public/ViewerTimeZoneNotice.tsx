import { useViewerTimeZoneControls } from "~/lib/viewer-timezone";
import { publicTimezoneOptions } from "~/lib/timezone-options-public";
import { m } from "~/paraglide/messages";

/**
 * "Times shown in (UTC−04:00) America/New York" affordance for public pages that
 * anchor dates to the viewer's own browser zone. It names the zone in effect so
 * the reader is never guessing which clock a timestamp is on, and lets them
 * switch to another zone when the browser guess is wrong (the choice is
 * remembered across these pages via the provider).
 *
 * Renders nothing until the browser zone resolves after mount — so it is absent
 * during SSR (no hydration mismatch) and hidden in print/PDF, where the fixed
 * UTC anchor stands on its own.
 */
export function ViewerTimeZoneNotice({ className }: { className?: string }) {
  const { tz, setTz, detected } = useViewerTimeZoneControls();

  // Nothing to offer until we've resolved the viewer's zone client-side.
  if (!detected) return null;

  const usingDetected = tz === detected;
  // Curated list, plus the viewer's own zone when it is not one of them. A
  // <select> whose value matches no <option> renders the FIRST one instead, so
  // omitting it would tell a viewer in an uncurated zone that their times are on
  // some other clock — silently, with nothing to notice.
  const options = publicTimezoneOptions(tz);

  return (
    <div
      className={`print:hidden text-[12px] text-ih-fg-3 ${className ?? ""}`}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>{m.public_viewer_tz_label()}</span>
        <select
          aria-label={m.public_viewer_tz_select_aria()}
          value={tz}
          onChange={(e) => setTz(e.target.value)}
          className="rounded-md border border-ih-border bg-ih-bg-card px-2 py-1 text-[12px] text-ih-fg-2 focus:outline-none focus-visible:shadow-ih-focus"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      {usingDetected && (
        <p className="mt-1 text-ih-fg-4">{m.public_viewer_tz_detected_note()}</p>
      )}
    </div>
  );
}
