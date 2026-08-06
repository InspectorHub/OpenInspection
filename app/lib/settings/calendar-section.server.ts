import type { CalendarCapability } from "~/components/settings/CalendarConnectPanel";
import type { CalendarPickerData } from "~/components/settings/CalendarReadSetPicker";
import type { IcsLinks } from "~/components/settings/IcsSubscribePanel";

const NO_LINKS: IcsLinks = { busyPath: null, schedulePath: null, companyPath: null };

/**
 * The subset of a fetch response this module uses. Deliberately structural
 * rather than `Response`: hono/client returns a ClientResponse, which is
 * Response-shaped for reading purposes but not assignable to it.
 */
interface ReadableRes {
  ok: boolean;
  json: () => Promise<unknown>;
}

export interface CalendarSection {
  connected: boolean;
  capability: CalendarCapability | null;
  oauthConfigured: boolean;
  lastSyncError: string | null;
  picker: CalendarPickerData | null;
}

/**
 * Everything the My Schedule page needs to know about the Google connection,
 * shaped in one place.
 *
 * It lives here rather than inline in the route because three separate
 * endpoints (status, read-set, ics-links) each need their envelope unwrapped
 * and defaulted, and that parsing is the bulk of the route's loader without
 * being any of the route's actual concerns.
 *
 * Every leg is best-effort: a Google hiccup hides the picker, it does not fail
 * the settings page.
 */
export async function loadCalendarSection(
  statusRes: ReadableRes | null,
  // Fetched by the caller so it joins the page's single Promise.all rather
  // than adding a serial round trip.
  icsLinksRes: ReadableRes | null,
  readSet: () => Promise<ReadableRes | null>,
  /** Managing someone else's schedule: the picker is owner-only, so skip it. */
  managingOther: boolean,
): Promise<{ calendar: CalendarSection; icsLinks: IcsLinks }> {
  const status = statusRes?.ok
    ? ((await statusRes.json()) as {
        data?: {
          connected?: boolean;
          capability?: CalendarCapability | null;
          oauthConfigured?: boolean;
          lastSyncError?: string | null;
        };
      }).data
    : null;

  let picker: CalendarPickerData | null = null;
  if (status?.connected && !managingOther) {
    const res = await readSet();
    if (res?.ok) {
      const d = ((await res.json()) as {
        data?: {
          connected?: boolean;
          connectionId?: string;
          writeCalendarId?: string;
          readCalendarIds?: string[];
          calendars?: CalendarPickerData["calendars"];
        };
      }).data;
      if (d?.connected && d.connectionId) {
        picker = {
          connectionId: d.connectionId,
          writeCalendarId: d.writeCalendarId ?? "",
          readCalendarIds: d.readCalendarIds ?? [],
          calendars: d.calendars ?? [],
        };
      }
    }
  }

  const icsLinks = icsLinksRes?.ok
    ? ((await icsLinksRes.json()) as { data?: IcsLinks }).data ?? NO_LINKS
    : NO_LINKS;

  return {
    calendar: {
      connected: status?.connected ?? false,
      capability: status?.capability ?? null,
      oauthConfigured: status?.oauthConfigured ?? false,
      lastSyncError: status?.lastSyncError ?? null,
      picker,
    },
    icsLinks,
  };
}
