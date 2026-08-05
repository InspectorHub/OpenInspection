/**
 * /calendar/dispatch — the dispatch board.
 *
 * The gate is a redirect, not an error page. Whether the actor may dispatch is
 * decided on the server — `GET /api/calendar/dispatch` mounts
 * requireCapability('scheduleOthers'), the same guard as the reschedule write —
 * and this loader simply honors its answer. That ordering matters: the page can
 * never offer an action the API would refuse, because it never learns about the
 * day at all unless the API already said yes.
 *
 * The board's payload types live in `~/components/dispatch/dispatch-helpers`
 * rather than here, so the components that render them and the loader that
 * fetches them cannot drift into two shapes of the same response.
 */
import { Link, useLoaderData } from "react-router";
import { redirect } from "react-router";
import { PageHeader, Button } from "@core/shared-ui";
import type { Route } from "./+types/calendar-dispatch";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { LoadFailedNotice } from "~/components/LoadFailedNotice";
import { DispatchBoard } from "~/components/dispatch/DispatchBoard";
import {
  shiftCivilDate,
  type DispatchPayload,
  type RescheduleResult,
  type ScheduleConflict,
} from "~/components/dispatch/dispatch-helpers";
import { m } from "~/paraglide/messages";

export function meta() {
  return [{ title: m.dispatch_meta_title() }];
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

/**
 * One drop, one write.
 *
 * The board never calls the API itself — a client `fetch('/api/…')` carries no
 * auth in this app, so the instant and the new lead travel through here and out
 * over the token-relay client. The three outcomes are kept DISTINCT on the way
 * back: applied cleanly, applied with advisory overlaps, and refused (409) by a
 * tenant that blocks double-booking. Flattening the last two into "there were
 * conflicts" is how a board ends up reporting a move the server declined.
 */
export async function action({ request, context }: Route.ActionArgs): Promise<RescheduleResult> {
  const token = await requireToken(context, request);
  const api = createApi(context, { token });
  const form = await request.formData();

  if (String(form.get("intent") ?? "") !== "reschedule") {
    return { ok: false, message: m.calendar_action_unknown() };
  }

  const inspectionId = String(form.get("inspectionId") ?? "");
  const scheduledStartMs = Number(form.get("scheduledStartMs"));
  if (!inspectionId || !Number.isFinite(scheduledStartMs) || scheduledStartMs <= 0) {
    return { ok: false, message: m.dispatch_toast_failed() };
  }

  // Empty string is an explicit UNASSIGN (the lane drop). An ABSENT key means
  // "leave assignment alone" — the schedule endpoint distinguishes the two by
  // key presence, so the difference has to survive the form encoding.
  const leadRaw = form.get("leadInspectorId");
  const assignment = leadRaw === null
    ? {}
    : { leadInspectorId: String(leadRaw) === "" ? null : String(leadRaw) };

  const res = await api.inspections[":id"].schedule.$patch({
    param: { id: inspectionId },
    json: { scheduledStartMs, ...assignment },
  });

  const body = (await res.json().catch(() => null)) as
    | { data?: { conflicts?: ScheduleConflict[] } ; error?: { code?: string; message?: string; conflicts?: ScheduleConflict[] } }
    | null;

  if (res.ok) {
    return { ok: true, conflicts: body?.data?.conflicts ?? [] };
  }
  return {
    ok: false,
    code: body?.error?.code ?? "RESCHEDULE_FAILED",
    message: body?.error?.message ?? m.dispatch_toast_failed(),
    conflicts: body?.error?.conflicts ?? [],
  };
}

export default function CalendarDispatchPage() {
  const { failed, board } = useLoaderData<typeof loader>();

  return (
    <div className="space-y-ih-list">
      {/* A board with no cards is a statement a dispatcher acts on by leaving
          the day alone. Say when it is not a real answer (IA-118). */}
      {failed && <LoadFailedNotice what={m.dispatch_load_failed_what()} />}

      <PageHeader
        title={m.dispatch_page_title()}
        meta={board ? board.date : undefined}
        actions={
          <span className="inline-flex items-center gap-2">
            <span className="rounded-full bg-ih-bg-muted px-3 py-1 text-[11px] font-bold text-ih-fg-3">
              {board?.conflictPolicy === "block"
                ? m.dispatch_policy_block()
                : m.dispatch_policy_advisory()}
            </span>
            <Link to="/calendar">
              <Button variant="secondary" size="sm">{m.calendar_page_title()}</Button>
            </Link>
          </span>
        }
      />

      {board && (
        <div className="flex items-center gap-2">
          <Link to={`/calendar/dispatch?date=${shiftCivilDate(board.date, -1)}`}>
            <Button variant="secondary" size="sm">{m.dispatch_nav_prev_day()}</Button>
          </Link>
          <Link to="/calendar/dispatch">
            <Button variant="secondary" size="sm">{m.calendar_nav_today()}</Button>
          </Link>
          <Link to={`/calendar/dispatch?date=${shiftCivilDate(board.date, 1)}`}>
            <Button variant="secondary" size="sm">{m.dispatch_nav_next_day()}</Button>
          </Link>
        </div>
      )}

      {board ? <DispatchBoard board={board} /> : null}
    </div>
  );
}
