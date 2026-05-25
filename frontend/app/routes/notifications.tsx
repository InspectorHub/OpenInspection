import { useLoaderData } from "react-router";
import type { Route } from "./+types/notifications";
import { requireToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";

export function meta() {
  return [{ title: "Notifications - OpenInspection" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch("/api/notifications", { token });
    const data = res.ok ? await res.json() : {};
    return {
      notifications: (data as Record<string, unknown[]>)?.data || [],
    };
  } catch {
    return { notifications: [] };
  }
}

export default function NotificationsPage() {
  const { notifications } = useLoaderData<typeof loader>();
  const notificationList = notifications as unknown[];

  return (
    <div className="space-y-[18px]">
      {/* PageHeader */}
      <div>
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-[0.2em] bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400">
          <span className="w-1 h-1 rounded-full bg-current opacity-60" />
          Notifications
        </span>
        <h1 className="text-[26px] font-bold tracking-tight mt-1">
          Notifications
        </h1>
        <p className="text-[13px] text-slate-500 mt-1">
          {notificationList.length} notifications
        </p>
      </div>

      {/* Content */}
      {notificationList.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
          <p className="font-semibold text-slate-700 dark:text-slate-200">
            No notifications
          </p>
          <p className="text-sm text-slate-500 mt-1">
            You&apos;re all caught up.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {notificationList.map((n: unknown) => {
            const notification = n as Record<string, string>;
            return (
              <div
                key={notification.id}
                className="p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
              >
                <p className="text-[13px] text-slate-900 dark:text-slate-100">
                  {notification.message}
                </p>
                <p className="text-[11px] text-slate-400 mt-1">
                  {notification.createdAt}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
