import { useLoaderData } from "react-router";
import type { Route } from "./+types/notifications";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { PageHeader, Card, EmptyState, Banner } from "@core/shared-ui";
import { formatRelativeTime } from "~/lib/format";
import { useDisplayLocale } from "~/hooks/useSessionContext";
import { m } from "~/paraglide/messages";

export function meta() {
  return [{ title: m.notifications_meta_title() }];
}

/**
 * One row as the API returns it — mirrors `dto()` in server/api/notifications.ts.
 *
 * This page used to type the payload as `unknown[]` and read each row through
 * `as Record<string, string>`, then render `notification.message`. There is no
 * `message` field, in the DTO or in the schema, so every notification rendered
 * as an empty paragraph with a timestamp under it: an entire staff alert centre
 * showing nothing but relative times (IA-112). The assertion is what made that
 * compile — naming the shape is the actual fix, and the reason the missing field
 * is now a type error rather than a blank page.
 */
interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  entityType: string | null;
  entityId: string | null;
  readAt: string | null;
  archivedAt: string | null;
  createdAt: string;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  // A failed fetch must not be indistinguishable from "you have no
  // notifications" — that renders a lookup failure as a confident answer, which
  // is the same defect this page already had once (IA-118 family).
  try {
    const api = createApi(context, { token });
    const res = await api.notifications.index.$get({ query: {} });
    if (!res.ok) return { notifications: [] as NotificationRow[], loadFailed: true };
    const body = (await res.json()) as { data?: NotificationRow[] };
    return { notifications: body.data ?? [], loadFailed: false };
  } catch {
    return { notifications: [] as NotificationRow[], loadFailed: true };
  }
}

export default function NotificationsPage() {
  const { notifications, loadFailed } = useLoaderData<typeof loader>();
  const locale = useDisplayLocale();

  return (
    <div className="space-y-ih-list">
      <PageHeader
        title={m.notifications_heading()}
        meta={m.notifications_meta({ count: notifications.length })}
      />

      {loadFailed ? (
        <Banner tone="danger">{m.notifications_load_failed()}</Banner>
      ) : notifications.length === 0 ? (
        <Card>
          <EmptyState
            title={m.notifications_empty_title()}
            description={m.notifications_empty_desc()}
          />
        </Card>
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => (
            <Card key={n.id} className="p-3">
              <p className="text-[13px] font-medium text-ih-fg-1">{n.title}</p>
              {/* `body` is optional in the DTO — several notification types carry
                  only a title, so an empty paragraph would just reintroduce the
                  blank row this page was full of. */}
              {n.body && <p className="text-[13px] text-ih-fg-2 mt-0.5">{n.body}</p>}
              <p className="text-[11px] text-ih-fg-4 mt-1">
                {formatRelativeTime(n.createdAt, { locale })}
              </p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
