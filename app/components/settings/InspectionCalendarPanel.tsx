import { Form } from "react-router";
import { CalendarGlyph } from "~/components/settings/CalendarGlyph";

/**
 * Inspection Calendar — vendor-neutral ICS subscription (read-only upcoming inspections).
 */
export function InspectionCalendarPanel({
  icsUrl,
  generatingIcsUrl,
  formError,
}: {
  icsUrl: string | null;
  generatingIcsUrl: boolean;
  formError: string | null;
}) {
  return (
    <div className="p-4 border border-ih-border rounded-lg space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-ih-bg-muted flex items-center justify-center">
          <CalendarGlyph className="w-4 h-4 text-ih-fg-3" />
        </div>
        <div>
          <p className="text-[13px] font-bold text-ih-fg-1">Inspection Calendar</p>
          <p className="text-[11px] text-ih-fg-3">Read-only ICS subscription</p>
        </div>
      </div>
      {icsUrl ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={icsUrl}
              className="flex-1 h-8 px-2 rounded-md border border-ih-border bg-ih-bg-muted text-[11px] font-mono text-ih-fg-3 outline-none"
            />
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(icsUrl);
              }}
              className="h-8 px-3 rounded-md bg-ih-primary text-white font-bold text-[12px] hover:bg-ih-primary-600 transition-colors shrink-0"
            >
              Copy
            </button>
          </div>
          <p className="text-[11px] text-ih-fg-3">
            Subscribe in Apple Calendar, Google Calendar, or Outlook using this URL. Shows upcoming
            inspections for the next 90 days (read-only).
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-[11px] text-ih-fg-3">
            Generate a subscription link to view upcoming inspections in any calendar app. This is
            separate from Google Calendar sync.
          </p>
          <Form method="post">
            <input type="hidden" name="intent" value="generate-ics-url" />
            <button
              type="submit"
              disabled={generatingIcsUrl}
              className="h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors disabled:opacity-60"
            >
              {generatingIcsUrl ? "Generating…" : "Generate subscription URL"}
            </button>
          </Form>
          {formError && (
            <p className="text-[11px] text-ih-bad-fg" role="alert">
              {formError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
