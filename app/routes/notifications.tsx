import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { useEffect } from "react";
import type { Route } from "./+types/notifications";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { PageHeader, Card, EmptyState, Banner } from "@core/shared-ui";
import { NoticeList } from "~/components/notices/NoticeList";
import type { NoticeRowData } from "~/lib/notice-view";
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
  const fetcher = useFetcher<{ ok?: boolean }>();
  const revalidator = useRevalidator();

  // A dismissal changes what the loader returned; re-read rather than patch a
  // local copy that can disagree with the server.
  useEffect(() => {
    if (fetcher.data?.ok) revalidator.revalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data]);

  // The staff DTO speaks ISO strings and carries no channels — a staff alert
  // was never dispatched anywhere. Same mapping as the bell's resource route.
  const notices: NoticeRowData[] = notifications.map((n) => ({
    id: n.id,
    tenantId: "",
    type: n.type,
    title: n.title,
    body: n.body,
    inspectionId: n.entityType === "inspection" ? n.entityId : null,
    createdAt: Date.parse(n.createdAt),
    readAt: n.readAt ? Date.parse(n.readAt) : null,
    channels: [],
  }));

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
        /* C4 — the SAME <NoticeList> the client, agent and staff bells render.
           A staff alert carries no channels, so the row shows no delivery line
           and no remedy without this page asking for a variant. Dismissing is
           the only action a staff notice has; the page is the full history the
           bell's panel truncates. */
        <Card className="p-0">
          <NoticeList
            notices={notices}
            emailComposer={false}
            emptyBody={m.notice_empty_body_staff()}
            onDismiss={(id) =>
              fetcher.submit(
                { intent: "notice-dismiss", noticeId: id },
                { method: "post", action: "/resources/staff-notices" },
              )
            }
            onRemedy={() => {}}
          />
        </Card>
      )}
    </div>
  );
}
