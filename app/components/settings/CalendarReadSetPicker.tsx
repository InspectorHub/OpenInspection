import { useState } from "react";
import { useFetcher } from "react-router";
import type { action } from "~/routes/settings-schedule";
import { m } from "~/paraglide/messages";

interface CalendarEntry {
  id: string;
  summary: string;
  accessRole: string;
  primary: boolean;
}

export interface CalendarPickerData {
  connectionId: string;
  writeCalendarId: string;
  readCalendarIds: string[];
  calendars: CalendarEntry[];
}

const WRITABLE = new Set(["owner", "writer"]);

/**
 * A-polish 10b.5 — the read-set / write-target picker. Read is a multi-select
 * (Primary locked on; the write calendar cannot be unchecked so write ∈ read
 * always holds); write is a single-select constrained to read-selected calendars
 * the user can edit. Saves through the settings-schedule action.
 */
export function CalendarReadSetPicker({ picker }: { picker: CalendarPickerData }) {
  const fetcher = useFetcher<typeof action>();
  const primaryId = picker.calendars.find((c) => c.primary)?.id;

  const [readIds, setReadIds] = useState<Set<string>>(() => {
    const s = new Set(picker.readCalendarIds);
    if (primaryId) s.add(primaryId);
    return s;
  });
  const [writeId, setWriteId] = useState(picker.writeCalendarId);

  const saving = fetcher.state !== "idle";
  const result =
    fetcher.state === "idle" && fetcher.data?.intent === "calendar-read-set-save"
      ? fetcher.data
      : null;

  function toggleRead(id: string) {
    // Primary is always checked; the write target must stay in the read set.
    if (id === primaryId || id === writeId) return;
    setReadIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const writeOptions = picker.calendars.filter(
    (c) => readIds.has(c.id) && WRITABLE.has(c.accessRole),
  );

  function save() {
    fetcher.submit(
      {
        intent: "calendar-read-set-save",
        connectionId: picker.connectionId,
        readCalendarIds: JSON.stringify([...readIds]),
        writeCalendarId: writeId,
      },
      { method: "post" },
    );
  }

  return (
    <div
      data-testid="calendar-read-set-picker"
      className="border-t border-ih-border pt-4 space-y-3"
    >
      <div>
        <h4 className="text-[12px] font-bold text-ih-fg-1">{m.settings_calpicker_heading()}</h4>
        <p className="text-[11px] text-ih-fg-3 mt-0.5">{m.settings_calpicker_desc()}</p>
      </div>

      {picker.calendars.length === 0 ? (
        <p className="text-[11px] text-ih-fg-3">{m.settings_calpicker_none()}</p>
      ) : (
        <>
          <fieldset className="space-y-1.5">
            <legend className="text-[11px] font-bold text-ih-fg-2 mb-1">
              {m.settings_calpicker_read_label()}
            </legend>
            {picker.calendars.map((c) => {
              const locked = c.id === primaryId;
              return (
                <label key={c.id} className="flex items-center gap-2 text-[12px] text-ih-fg-1">
                  <input
                    type="checkbox"
                    data-testid={`read-cal-${c.id}`}
                    checked={readIds.has(c.id)}
                    disabled={locked || saving}
                    onChange={() => toggleRead(c.id)}
                    className="h-3.5 w-3.5 rounded border-ih-border text-ih-primary"
                  />
                  <span>{c.summary}</span>
                  {locked && (
                    <span className="text-[10px] text-ih-fg-4">
                      {m.settings_calpicker_primary_locked()}
                    </span>
                  )}
                </label>
              );
            })}
          </fieldset>

          <div className="space-y-1.5">
            <label
              htmlFor="calpicker-write"
              className="block text-[11px] font-bold text-ih-fg-2"
            >
              {m.settings_calpicker_write_label()}
            </label>
            <select
              id="calpicker-write"
              data-testid="write-cal-select"
              value={writeId}
              disabled={saving}
              onChange={(e) => setWriteId(e.target.value)}
              className="h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[12px] text-ih-fg-1 max-w-sm w-full focus:border-ih-primary focus:shadow-ih-focus outline-none"
            >
              {writeOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.summary}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-ih-fg-4">{m.settings_calpicker_write_only_editable()}</p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="calpicker-save"
              onClick={save}
              disabled={saving}
              className="h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[12px] hover:bg-ih-primary-600 transition-colors disabled:opacity-60"
            >
              {saving ? m.settings_calpicker_saving() : m.settings_calpicker_save()}
            </button>
            {result && (
              <span
                role={result.ok ? "status" : "alert"}
                className={`text-[11px] ${result.ok ? "text-ih-ok-fg" : "text-ih-bad-fg"}`}
              >
                {result.ok
                  ? m.settings_calpicker_saved()
                  : result.message ?? m.settings_calpicker_save_failed()}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
