/**
 * BFF resource route: which booked inspections would a block of time off cover?
 *
 * Loaded with `useFetcher` by the block-time drawer BEFORE it saves, because a
 * browser `fetch('/api/…')` carries no auth here (the JWT lives in an HttpOnly
 * cookie the React Router server relays). The answer is advisory: a failed
 * lookup returns `ok: false` with no conflicts and the drawer saves anyway, since
 * the server never requires the confirmation this exists to ask for.
 */
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import type { LoadContext } from "~/lib/load-context";

export interface BlockConflict {
  id: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
}

export interface BlockConflictsPayload {
  ok: boolean;
  conflicts: BlockConflict[];
}

export async function loader({ request, context }: { request: Request; context: LoadContext }): Promise<BlockConflictsPayload> {
  const token = await requireToken(context, request);
  const api = createApi(context, { token });
  const q = new URL(request.url).searchParams;
  const date = q.get("date") ?? "";
  if (!date) return { ok: false, conflicts: [] };
  const userId = q.get("userId");
  const startTime = q.get("startTime");
  const endTime = q.get("endTime");

  const res = await api.calendar.blocks.conflicts
    .$get({
      query: {
        date,
        ...(userId ? { userId } : {}),
        ...(q.get("allDay") === "true" ? { allDay: "true" as const } : {}),
        ...(startTime ? { startTime } : {}),
        ...(endTime ? { endTime } : {}),
      },
    })
    .catch(() => null);
  if (!res?.ok) return { ok: false, conflicts: [] };
  const body = (await res.json().catch(() => null)) as { data?: { conflicts?: BlockConflict[] } } | null;
  return { ok: true, conflicts: body?.data?.conflicts ?? [] };
}
