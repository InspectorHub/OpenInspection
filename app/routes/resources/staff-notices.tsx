/**
 * BFF resource route for the inspector portal's Notices bell.
 *
 * The staff bell used to be a link to /notifications. It is a Popover now, for
 * the same reason the other two portals have one: "sent to me" is a glance,
 * not a page. All three read the SAME component; only the payload differs.
 *
 * Staff notices carry no channels — they were never dispatched anywhere, they
 * are alerts about the workspace (the old `notifications` semantics, which
 * Track B migrates). `NoticeList` renders a row with no channel line and no
 * remedy for them without a branch, which is the test of whether the shared
 * component was actually shared or just co-located.
 */
import type { Route } from "./+types/staff-notices";
import { getToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import type { NoticeRowData } from "~/lib/notice-view";

export interface StaffNoticesPayload {
  notices: NoticeRowData[];
  unread: number;
}

const EMPTY: StaffNoticesPayload = { notices: [], unread: 0 };

interface StaffNoticeDto {
  id: string;
  type: string;
  title: string;
  body: string | null;
  entityType: string | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
}

/** The staff DTO speaks ISO strings and knows nothing about channels. */
function toNoticeRow(dto: StaffNoticeDto): NoticeRowData {
  return {
    id: dto.id,
    tenantId: "",
    type: dto.type,
    title: dto.title,
    body: dto.body,
    inspectionId: dto.entityType === "inspection" ? dto.entityId : null,
    createdAt: Date.parse(dto.createdAt),
    readAt: dto.readAt ? Date.parse(dto.readAt) : null,
    channels: [],
  };
}

export async function loader({ request, context }: Route.LoaderArgs): Promise<StaffNoticesPayload> {
  const token = await getToken(context, request);
  if (!token) return EMPTY;
  const api = createApi(context, { token });
  const headers = { "x-token-relay": "1" };
  try {
    const [listRes, countRes] = await Promise.all([
      api.notifications.index.$get({ query: {} }, { headers }),
      api.notifications["unread-count"].$get({}, { headers }),
    ]);
    if (!listRes.ok) return EMPTY;
    const list = (await listRes.json()) as { data?: StaffNoticeDto[] };
    const count = countRes.ok
      ? ((await countRes.json()) as { data?: { count?: number } }).data?.count ?? 0
      : 0;
    return { notices: (list.data ?? []).map(toNoticeRow), unread: count };
  } catch {
    return EMPTY;
  }
}

export type StaffNoticeActionResult =
  | { ok: true; intent: "notice-mark-all-read" }
  | { ok: true; intent: "notice-dismiss" }
  | { ok: false; intent: string };

export async function action({ request, context }: Route.ActionArgs): Promise<StaffNoticeActionResult> {
  const token = await getToken(context, request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const noticeId = String(form.get("noticeId") ?? "");
  if (!token) return { ok: false, intent };

  const api = createApi(context, { token });
  const headers = { "x-token-relay": "1" };
  try {
    if (intent === "notice-mark-all-read") {
      await api.notifications["mark-all-read"].$post({}, { headers });
      return { ok: true, intent };
    }
    if (intent === "notice-dismiss" && noticeId) {
      // DELETE archives — it is a soft-delete on the inbox row, and it never
      // touches the delivery ledger.
      await api.notifications[":id"].$delete({ param: { id: noticeId } }, { headers });
      return { ok: true, intent };
    }
  } catch {
    return { ok: false, intent };
  }
  return { ok: false, intent };
}
