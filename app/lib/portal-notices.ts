/**
 * BFF seam for the client portal's Notices bell.
 *
 * Lives beside the Hub route rather than inside it for the file-size ratchet,
 * and because the read and the three writes are one seam: every one of them is
 * the same "forward the portal session cookie into the in-process API" move,
 * and splitting them would put half of that reasoning in two places.
 *
 * The browser never calls the API directly (CLAUDE.md BFF rule) — the session
 * cookie is HttpOnly and the typed client does not forward it, so both
 * directions are threaded explicitly here.
 */
import type { Api } from "~/lib/api-client.server";
import type { NoticeRowData } from "~/lib/notice-view";

export interface PortalNoticesPayload {
  notices: NoticeRowData[];
  unread: number;
}

export const EMPTY_NOTICES: PortalNoticesPayload = { notices: [], unread: 0 };

/**
 * Best-effort: a failed read degrades to an empty bell rather than taking the
 * whole Hub down. That is the right trade here and only here — the bell is
 * ambient, while the Hub's own status cards are the page's reason to exist.
 */
export async function loadPortalNotices(
  api: Api,
  tenant: string,
  cookie: string,
): Promise<PortalNoticesPayload> {
  try {
    const res = await api.portalNotices[":tenant"].notices.$get(
      { param: { tenant } },
      { headers: { Cookie: cookie } },
    );
    if (!res.ok) return EMPTY_NOTICES;
    const body = (await res.json()) as { data?: PortalNoticesPayload };
    return body.data ?? EMPTY_NOTICES;
  } catch {
    return EMPTY_NOTICES;
  }
}

export type PortalNoticeActionResult =
  | { ok: true; intent: "notice-mark-all-read" }
  | { ok: true; intent: "notice-dismiss" }
  | { ok: true; intent: "notice-optin-link"; url: string }
  | { ok: false; intent: string };

/** Handles the bell's three write intents; returns null for anything else. */
export async function handlePortalNoticeIntent(
  api: Api,
  tenant: string,
  cookie: string,
  intent: string,
  noticeId: string,
): Promise<PortalNoticeActionResult | null> {
  const headers = { Cookie: cookie };
  try {
    if (intent === "notice-mark-all-read") {
      await api.portalNotices[":tenant"].notices["mark-read"].$post(
        { param: { tenant }, json: {} },
        { headers },
      );
      return { ok: true, intent };
    }
    if (intent === "notice-dismiss") {
      if (!noticeId) return { ok: false, intent };
      await api.portalNotices[":tenant"].notices[":id"].$delete(
        { param: { tenant, id: noticeId } },
        { headers },
      );
      return { ok: true, intent };
    }
    if (intent === "notice-optin-link") {
      if (!noticeId) return { ok: false, intent };
      const res = await api.portalNotices[":tenant"].notices[":id"]["optin-link"].$get(
        { param: { tenant, id: noticeId } },
        { headers },
      );
      if (!res.ok) return { ok: false, intent };
      const body = (await res.json()) as { data?: { url?: string } };
      const url = body.data?.url;
      return url ? { ok: true, intent, url } : { ok: false, intent };
    }
  } catch {
    return { ok: false, intent };
  }
  return null;
}
