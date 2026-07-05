import { useLoaderData } from "react-router";
import type { Route } from "./+types/notifications";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { PageHeader, Card, EmptyState } from "@core/shared-ui";

export function meta() {
  return [{ title: "Notifications - OpenInspection" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  try {
    const api = createApi(context, { token });
    const res = await api.notifications.index.$get({ query: {} });
    const body = res.ok ? ((await res.json()) as Record<string, unknown>) : { data: [] };
    return {
      notifications: (body.data ?? []) as unknown[],
    };
  } catch {
    return { notifications: [] };
  }
}

export default function NotificationsPage() {
  const { notifications } = useLoaderData<typeof loader>();
  const notificationList = notifications as unknown[];

  return (
    <div className="space-y-ih-list">
      <PageHeader
        title="Notifications"
        meta={`${notificationList.length} notifications`}
      />

      {/* Content */}
      {notificationList.length === 0 ? (
        <Card>
          <EmptyState
            title="No notifications"
            description="You're all caught up."
          />
        </Card>
      ) : (
        <div className="space-y-2">
          {notificationList.map((n: unknown) => {
            const notification = n as Record<string, string>;
            return (
              <Card key={notification.id} className="p-3">
                <p className="text-[13px] text-ih-fg-1">
                  {notification.message}
                </p>
                <p className="text-[11px] text-ih-fg-4 mt-1">
                  {notification.createdAt}
                </p>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
