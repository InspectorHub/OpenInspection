/**
 * BFF resource route for the agent portal's Notices bell (C3).
 *
 * The client's equivalent hangs off the Hub route's own action; the agent's
 * bell lives in a LAYOUT, which no fetcher can post to by path, so its writes
 * get a resource route instead. Same three intents, same relay through the
 * token BFF — a browser `fetch('/api/...')` would carry no auth.
 *
 * Reads ride the agent-layout loader, so the unread badge is correct before
 * the panel is ever opened.
 */
import type { Route } from "./+types/agent-notices";
import { getToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";

export type AgentNoticeActionResult =
  | { ok: true; intent: "notice-mark-all-read" }
  | { ok: true; intent: "notice-dismiss" }
  | { ok: true; intent: "notice-optin-link"; url: string }
  | { ok: false; intent: string };

export async function action({ request, context }: Route.ActionArgs): Promise<AgentNoticeActionResult> {
  const token = await getToken(context, request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const noticeId = String(form.get("noticeId") ?? "");
  if (!token) return { ok: false, intent };

  const api = createApi(context, { token });
  const headers = { "x-token-relay": "1" };
  try {
    if (intent === "notice-mark-all-read") {
      await api.agentNotices.notices["mark-read"].$post({ json: {} }, { headers });
      return { ok: true, intent };
    }
    if (intent === "notice-dismiss" && noticeId) {
      await api.agentNotices.notices[":id"].$delete({ param: { id: noticeId } }, { headers });
      return { ok: true, intent };
    }
    if (intent === "notice-optin-link" && noticeId) {
      const res = await api.agentNotices.notices[":id"]["optin-link"].$get({ param: { id: noticeId } }, { headers });
      if (!res.ok) return { ok: false, intent };
      const body = (await res.json()) as { data?: { url?: string } };
      return body.data?.url ? { ok: true, intent, url: body.data.url } : { ok: false, intent };
    }
  } catch {
    return { ok: false, intent };
  }
  return { ok: false, intent };
}
