import { useState, useMemo } from "react";
import { useLoaderData, useFetcher, useNavigate, useNavigation } from "react-router";
import type { Route } from "./+types/calendar";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { PageHeader } from "@core/shared-ui";
import { useDisplayTimeZone } from "~/hooks/useSessionContext";
import { isAdminRole } from "~/lib/access";
import {
  startOfWeek,
  addDays,
  calendarItemToEvent,
  defaultCalendarScope,
  type CalendarEvent,
  type CalendarItem,
  type CalendarScope,
  type ViewMode,
} from "~/components/calendar/calendar-helpers";
import { BlockTimeDrawer, type CalendarMember } from "~/components/calendar/BlockTimeDrawer";
import { CalendarScopeToolbar } from "~/components/calendar/CalendarScopeToolbar";
import { CalendarNavBar } from "~/components/calendar/CalendarNavBar";
import { CalendarEventModal } from "~/components/calendar/CalendarEventModal";
import { CalendarLoadingSkeleton } from "~/components/calendar/CalendarLoadingSkeleton";
import { MonthView } from "~/components/calendar/MonthView";
import { WeekView } from "~/components/calendar/WeekView";
import { DayView } from "~/components/calendar/DayView";

export function meta() {
  return [{ title: "Calendar - OpenInspection" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  const api = createApi(context, { token });
  const url = new URL(request.url);
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
  const end = new Date(now.getFullYear(), now.getMonth() + 2, 0).toISOString();

  try {
    const meGet = api.auth.me.$get as unknown as (args?: unknown) => Promise<Response>;
    const [meRes, membersRes] = await Promise.all([
      meGet().catch(() => null),
      api.admin.members.$get().catch(() => null),
    ]);
    if (!meRes?.ok) throw new Error("Current user unavailable");

    const meBody = (await meRes.json()) as { data?: { user?: { id?: string; role?: string } } };
    const currentUserId = meBody.data?.user?.id ?? "";
    const role = meBody.data?.user?.role ?? "inspector";
    const canManageTeam = isAdminRole(role);
    const requestedScope = url.searchParams.get("scope");
    // Admins default to Team; honor an explicit ?scope=my. Inspectors always My.
    const scope: CalendarScope = !canManageTeam
      ? "my"
      : requestedScope === "my"
        ? "my"
        : requestedScope === "team"
          ? "team"
          : defaultCalendarScope(role);

    let members: CalendarMember[] = [];
    if (canManageTeam && membersRes?.ok) {
      const membersBody = (await membersRes.json()) as {
        data?: Array<{ id: string; email: string; name?: string | null; role: string }>;
      };
      members = (membersBody.data ?? [])
        .filter((member) => ["owner", "manager", "inspector"].includes(member.role))
        .map((member) => ({
          id: member.id,
          email: member.email,
          name: member.name?.trim() || member.email,
          role: member.role,
        }));
    }

    const hasUserSelection = url.searchParams.has("userIds");
    const selectedUserIds = scope === "team"
      ? hasUserSelection
        ? (url.searchParams.get("userIds") ?? "").split(",").filter((id) => members.some((member) => member.id === id))
        : members.map((member) => member.id)
      : [currentUserId];

    if (selectedUserIds.length === 0) {
      return { events: [] as CalendarEvent[], members, currentUserId, role, scope, selectedUserIds };
    }

    const query = scope === "my"
      ? { start, end, userId: currentUserId }
      : { start, end, userIds: selectedUserIds.join(",") };
    const itemsRes = await api.calendar.items.$get({ query });
    const body = itemsRes.ok
      ? ((await itemsRes.json()) as { data?: { items?: CalendarItem[] } })
      : { data: { items: [] as CalendarItem[] } };
    const events = (body.data?.items ?? []).map(calendarItemToEvent);
    return { events, members, currentUserId, role, scope, selectedUserIds };
  } catch {
    return {
      events: [] as CalendarEvent[],
      members: [] as CalendarMember[],
      currentUserId: "",
      role: "inspector",
      scope: "my" as const,
      selectedUserIds: [] as string[],
    };
  }
}

async function responseMessage(response: { json: () => Promise<unknown> }, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  return body?.error?.message ?? fallback;
}

export async function action({ request, context }: Route.ActionArgs) {
  const token = await requireToken(context, request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const api = createApi(context, { token });

  if (intent === "reschedule") {
    const id = formData.get("id") as string;
    const date = formData.get("date") as string;
    const res = await api.inspections[":id"].$patch({
      param: { id },
      json: { date },
    });
    return { ok: res.ok };
  }

  if (intent === "block-create" || intent === "block-update") {
    const allDay = formData.get("allDay") === "true";
    const payload = {
      title: String(formData.get("title") ?? ""),
      date: String(formData.get("date") ?? ""),
      allDay,
      startTime: allDay ? null : String(formData.get("startTime") ?? ""),
      endTime: allDay ? null : String(formData.get("endTime") ?? ""),
      notes: String(formData.get("notes") ?? "") || null,
      userId: String(formData.get("userId") ?? ""),
    };
    const res = intent === "block-create"
      ? await api.calendar.blocks.$post({ json: payload })
      : await api.calendar.blocks[":id"].$patch({
          param: { id: String(formData.get("id") ?? "") },
          json: payload,
        });
    return {
      ok: res.ok,
      intent,
      message: res.ok ? null : await responseMessage(res, "Unable to save blocked time."),
    };
  }

  if (intent === "block-delete") {
    const res = await api.calendar.blocks[":id"].$delete({
      param: { id: String(formData.get("id") ?? "") },
    });
    return {
      ok: res.ok,
      intent,
      message: res.ok ? null : await responseMessage(res, "Unable to delete blocked time."),
    };
  }

  return { ok: false, intent, message: "Unknown calendar action." };
}

export default function CalendarPage() {
  const { events, members, currentUserId, role, scope, selectedUserIds } = useLoaderData<typeof loader>();
  const displayTz = useDisplayTimeZone();
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const navigation = useNavigation();
  const isLoading = navigation.state === "loading";
  const canManageTeam = isAdminRole(role);

  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [blockDrawerOpen, setBlockDrawerOpen] = useState(false);
  const [selectedBlock, setSelectedBlock] = useState<CalendarEvent | null>(null);
  const [blockDateSeed, setBlockDateSeed] = useState<string | null>(null);
  const [, setDragTarget] = useState<string | null>(null);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const prev = () => {
    if (viewMode === "month") setCurrentDate(new Date(year, month - 1, 1));
    else if (viewMode === "week") setCurrentDate(addDays(currentDate, -7));
    else setCurrentDate(addDays(currentDate, -1));
  };
  const next = () => {
    if (viewMode === "month") setCurrentDate(new Date(year, month + 1, 1));
    else if (viewMode === "week") setCurrentDate(addDays(currentDate, 7));
    else setCurrentDate(addDays(currentDate, 1));
  };

  const headerTitle = useMemo(() => {
    if (viewMode === "month") return currentDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    if (viewMode === "week") {
      const ws = startOfWeek(currentDate);
      const we = addDays(ws, 6);
      return `${ws.toLocaleDateString("en-US", { month: "short", day: "numeric" })} - ${we.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
    }
    return currentDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  }, [currentDate, viewMode]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      const d = ev.start ? new Date(ev.start) : null;
      if (!d || isNaN(d.getTime())) continue;
      const key = d.toISOString().slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(ev);
    }
    return map;
  }, [events]);

  function getEventsForDate(d: Date) {
    return eventsByDate.get(d.toISOString().slice(0, 10)) || [];
  }

  const now = new Date();
  const weekEnd = addDays(now, 7);
  const thisWeekEvents = events.filter((e) => {
    const d = new Date(e.start);
    return d >= now && d < weekEnd;
  });
  const drafts = thisWeekEvents.filter((e) => e.status === "draft" || e.isDraft);
  const confirmed = thisWeekEvents.length - drafts.length;

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();
  const today = new Date();
  const isToday = (day: number) => today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
  const weekStart = startOfWeek(viewMode === "week" ? currentDate : today);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const hours = Array.from({ length: 14 }, (_, i) => i + 7);

  const handleEventClick = (ev: CalendarEvent) => {
    if (ev.extendedProps?.kind === "calendar_block") {
      setSelectedBlock(ev);
      setBlockDateSeed(null);
      setBlockDrawerOpen(true);
      return;
    }
    if (ev.extendedProps?.kind === "external_busy") return;
    setSelectedEvent(ev);
    setEventModalOpen(true);
  };

  const handleDayClick = (dateStr: string) => {
    setSelectedBlock(null);
    setBlockDateSeed(dateStr);
    setBlockDrawerOpen(true);
  };

  const handleDrop = (eventId: string, newDate: string) => {
    fetcher.submit({ intent: "reschedule", id: eventId, date: newDate }, { method: "post" });
  };

  function setScope(nextScope: CalendarScope) {
    const params = new URLSearchParams();
    params.set("scope", nextScope);
    if (nextScope === "team") params.set("userIds", members.map((member) => member.id).join(","));
    navigate(`/calendar?${params.toString()}`);
  }

  function toggleMember(memberId: string) {
    const next = selectedUserIds.includes(memberId)
      ? selectedUserIds.filter((id) => id !== memberId)
      : [...selectedUserIds, memberId];
    const params = new URLSearchParams();
    params.set("scope", "team");
    params.set("userIds", next.join(","));
    navigate(`/calendar?${params.toString()}`);
  }

  return (
    <div className="space-y-ih-list">
      <PageHeader
        title="Calendar"
        meta={
          thisWeekEvents.length === 0
            ? "No inspections scheduled this week"
            : drafts.length > 0
              ? `${confirmed} confirmed · ${drafts.length} draft${drafts.length === 1 ? "" : "s"}`
              : `${thisWeekEvents.length} this week`
        }
      />

      <CalendarScopeToolbar
        scope={scope}
        role={role}
        members={members}
        selectedUserIds={selectedUserIds}
        onScopeChange={setScope}
        onToggleMember={toggleMember}
      />

      <CalendarNavBar
        title={headerTitle}
        viewMode={viewMode}
        onPrev={prev}
        onNext={next}
        onToday={() => setCurrentDate(new Date())}
        onViewModeChange={setViewMode}
      />

      {isLoading && <CalendarLoadingSkeleton />}

      {!isLoading && viewMode === "month" && (
        <MonthView
          firstDay={firstDay}
          daysInMonth={daysInMonth}
          year={year}
          month={month}
          getEventsForDate={getEventsForDate}
          isToday={isToday}
          handleDayClick={handleDayClick}
          setDragTarget={setDragTarget}
          handleDrop={handleDrop}
          handleEventClick={handleEventClick}
        />
      )}

      {!isLoading && viewMode === "week" && (
        <WeekView
          weekDays={weekDays}
          today={today}
          hours={hours}
          getEventsForDate={getEventsForDate}
          handleDayClick={handleDayClick}
          handleDrop={handleDrop}
          handleEventClick={handleEventClick}
        />
      )}

      {!isLoading && viewMode === "day" && (
        <DayView
          hours={hours}
          currentDate={currentDate}
          getEventsForDate={getEventsForDate}
          handleDayClick={handleDayClick}
          handleDrop={handleDrop}
          handleEventClick={handleEventClick}
        />
      )}

      {selectedEvent && (
        <CalendarEventModal
          event={selectedEvent}
          open={eventModalOpen}
          displayTz={displayTz}
          onClose={() => setEventModalOpen(false)}
        />
      )}

      <BlockTimeDrawer
        open={blockDrawerOpen}
        block={selectedBlock}
        dateSeed={blockDateSeed}
        currentUserId={currentUserId}
        members={members}
        canManageTeam={canManageTeam}
        onClose={() => setBlockDrawerOpen(false)}
      />
    </div>
  );
}
