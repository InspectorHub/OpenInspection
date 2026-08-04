/**
 * /calendar/dispatch — the dispatch board's DATA half.
 *
 * This module deliberately exports a loader and no component yet: the board UI
 * (DispatchBoard, the unassigned lane, drag-drop) is the next task, and landing
 * the data contract first means it can be reviewed on its own terms. Adding the
 * default export is that task's first step.
 *
 * The gate is a redirect, not an error page. Whether the actor may dispatch is
 * decided on the server — `GET /api/calendar/dispatch` mounts
 * requireCapability('scheduleOthers'), the same guard as the reschedule write —
 * and this loader simply honors its answer. That ordering matters: the page can
 * never offer an action the API would refuse, because it never learns about the
 * day at all unless the API already said yes.
 */
import { redirect } from "react-router";
import type { Route } from "./+types/calendar-dispatch";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";

interface DispatchInspector {
  id: string;
  name: string | null;
  email: string;
  role: string;
}

interface DispatchItem {
  id: string;
  kind: string;
  title: string;
  start: string;
  end: string;
  civilDate: string;
  startTime?: string;
  endTime?: string;
  allDay: boolean;
  color?: string;
  inspectionId?: string;
  userId?: string;
  meta?: Record<string, unknown>;
}

interface DispatchPayload {
  date: string;
  conflictPolicy: "advisory" | "block";
  inspectors: DispatchInspector[];
  items: DispatchItem[];
  unassigned: DispatchItem[];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  const api = createApi(context, { token });

  const requestedDate = new URL(request.url).searchParams.get("date");
  // No client-side default for the day: today depends on the TENANT timezone,
  // which the server resolves. Sending a browser-derived date would put a
  // west-coast owner on tomorrow's board every evening.
  const query: { date?: string } = {};
  if (requestedDate) query.date = requestedDate;

  const res = await api.calendar.dispatch
    .$get({ query })
    .catch(() => null);

  // 403 = no scheduleOthers. Inspectors who followed a link land on their own
  // calendar rather than a dead end.
  if (res?.status === 403) throw redirect("/calendar");
  if (!res?.ok) {
    return {
      failed: true as const,
      board: null,
    };
  }

  const body = (await res.json()) as { data?: DispatchPayload };
  const board = body.data ?? null;
  if (!board) return { failed: true as const, board: null };

  return { failed: false as const, board };
}
