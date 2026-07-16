import type { createApi } from "~/lib/api-client.server";

export async function getScheduleSet(api: ReturnType<typeof createApi>): Promise<boolean> {
  const [availabilityRes, calendarStatusRes] = await Promise.all([
    api.availability.index.$get({ query: {} }).catch(() => null),
    api.calendar.status.$get().catch(() => null),
  ]);
  const availability = availabilityRes?.ok
    ? ((await availabilityRes.json().catch(() => ({}))) as { data?: unknown[] }).data ?? []
    : [];
  const calendarStatus = calendarStatusRes?.ok
    ? ((await calendarStatusRes.json().catch(() => ({}))) as { data?: { connected?: boolean } }).data
    : null;
  return availability.length > 0 || calendarStatus?.connected === true;
}
