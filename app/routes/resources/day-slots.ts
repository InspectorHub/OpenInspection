/**
 * BFF resource route for Find-a-Time.
 *
 * Loaded with `useFetcher` from the new-inspection wizard. It exists because a
 * browser `fetch('/api/…')` in this app carries no auth — the JWT lives in an
 * HttpOnly cookie the React Router server holds and relays. So slot data has to
 * come through a loader, and this is the smallest one that does it.
 *
 * A failure returns an EMPTY slot list with `failed: true` rather than an empty
 * list alone: "nobody is free" and "we could not find out" are different
 * answers, and Find-a-Time is a surface where confusing them sends a dispatcher
 * to call an inspector who was actually available.
 */
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import type { LoadContext } from "~/lib/load-context";

export interface DaySlot {
  time: string;
  available: boolean;
  inspectorIds: string[];
}

export interface DaySlotsPayload {
  failed: boolean;
  date: string;
  intervalMin: number;
  slots: DaySlot[];
  holidayAdvisory: { date: string; name: string } | null;
}

export async function loader({
  request,
  context,
}: {
  request: Request;
  context: LoadContext;
}): Promise<DaySlotsPayload> {
  const token = await requireToken(context, request);
  const api = createApi(context, { token });
  const url = new URL(request.url);
  const date = url.searchParams.get("date") ?? "";
  const userIds = url.searchParams.get("userIds") ?? "";

  const empty: DaySlotsPayload = {
    failed: true,
    date,
    intervalMin: 30,
    slots: [],
    holidayAdvisory: null,
  };
  if (!date) return { ...empty, failed: false };

  const res = await api.schedule["day-slots"]
    .$get({ query: { date, ...(userIds ? { userIds } : {}) } })
    .catch(() => null);
  if (!res?.ok) return empty;

  const body = (await res.json()) as { data?: Omit<DaySlotsPayload, "failed"> };
  const data = body.data;
  if (!data) return empty;

  return {
    failed: false,
    date: data.date,
    intervalMin: data.intervalMin,
    slots: data.slots,
    holidayAdvisory: data.holidayAdvisory ?? null,
  };
}
