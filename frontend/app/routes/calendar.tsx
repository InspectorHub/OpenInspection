import { useState } from "react";
import { useLoaderData } from "react-router";
import type { Route } from "./+types/calendar";
import { requireToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";

export function meta() {
  return [{ title: "Calendar - OpenInspection" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch("/api/calendar/events", { token });
    const data = res.ok ? await res.json() : {};
    return { events: (data as any)?.data || [] };
  } catch {
    return { events: [] };
  }
}

export default function CalendarPage() {
  const { events } = useLoaderData<typeof loader>();
  const [currentDate, setCurrentDate] = useState(new Date());

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();
  const monthName = currentDate.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));
  const goToday = () => setCurrentDate(new Date());

  const today = new Date();
  const isToday = (day: number) =>
    today.getFullYear() === year &&
    today.getMonth() === month &&
    today.getDate() === day;

  return (
    <div className="space-y-[18px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-[0.2em] bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400">
            <span className="w-1 h-1 rounded-full bg-current opacity-60" />
            Calendar
          </span>
          <h1 className="text-[26px] font-bold tracking-tight mt-1">
            Calendar
          </h1>
          <p className="text-[13px] text-slate-500 mt-1">
            {events.length} events this month
          </p>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={prevMonth}
            className="h-9 w-9 rounded-md border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            &lsaquo;
          </button>
          <button
            onClick={nextMonth}
            className="h-9 w-9 rounded-md border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            &rsaquo;
          </button>
          <button
            onClick={goToday}
            className="h-9 px-3 rounded-md border border-slate-200 dark:border-slate-700 text-[13px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            today
          </button>
        </div>
        <h2 className="text-xl font-bold">{monthName}</h2>
        <div className="flex items-center gap-1">
          {["month", "week", "day"].map((v) => (
            <button
              key={v}
              className="h-9 px-3 rounded-md text-[13px] font-bold capitalize border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Month grid */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
        <div className="grid grid-cols-7">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div
              key={d}
              className="py-2 px-3 text-center text-[11px] font-bold uppercase tracking-wide text-slate-400 border-b border-slate-200 dark:border-slate-700"
            >
              {d}
            </div>
          ))}
          {Array.from({ length: firstDay }).map((_, i) => (
            <div
              key={`empty-${i}`}
              className="min-h-[80px] border-b border-r border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50"
            />
          ))}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            return (
              <div
                key={day}
                className={`min-h-[80px] p-1.5 border-b border-r border-slate-100 dark:border-slate-700 ${isToday(day) ? "bg-indigo-50/50 dark:bg-indigo-900/10" : ""}`}
              >
                <span
                  className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[12px] font-medium ${isToday(day) ? "bg-indigo-600 text-white" : "text-slate-700 dark:text-slate-300"}`}
                >
                  {day}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
