/**
 * The agent portal's Notices bell, wired.
 *
 * Same shared <NoticeBell> the client Hub uses — after C1 a notice is one
 * entity regardless of who reads it (design §3.11), so a second component
 * would only be a copy waiting to drift. Two honest differences, both props:
 *
 *  - Rows name the sending COMPANY. An agent's inbox spans every company that
 *    has them as a contact, so "who sent this" is information the client's
 *    single-company inbox does not need.
 *  - No email remedy. It opens a message composer, and the agent portal has
 *    none yet (Track D). A button with nothing behind it is worse than the
 *    plain "Not delivered" the reader gets instead.
 */
import { useEffect } from "react";
import { useFetcher, useRevalidator } from "react-router";
import { m } from "~/paraglide/messages";
import { NoticeBell } from "~/components/notices/NoticeBell";
import type { NoticeRowData, NoticeRemedy } from "~/lib/notice-view";

export function AgentNoticeBell({ notices, unread }: { notices: NoticeRowData[]; unread: number }) {
  const fetcher = useFetcher<{ ok?: boolean; intent?: string; url?: string }>();
  const revalidator = useRevalidator();

  useEffect(() => {
    const data = fetcher.data;
    if (!data?.ok) return;
    // Full navigation for the opt-in link: the sealed token's base64 can
    // contain "/", so a decoded client-side match sees two path segments and
    // renders nothing (same reason as PortalNoticeBell — verified in Chrome).
    if (data.intent === "notice-optin-link" && data.url) window.location.assign(data.url);
    else revalidator.revalidate();
    // Keyed on the fetcher payload so each completed write acts once; the
    // revalidator's identity changes on every state transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data]);

  const submit = (intent: string, noticeId?: string) =>
    fetcher.submit(
      { intent, ...(noticeId ? { noticeId } : {}) },
      { method: "post", action: "/resources/agent-notices" },
    );

  const onRemedy = (remedy: NoticeRemedy) => {
    if (remedy.kind === "sms-consent") submit("notice-optin-link", remedy.noticeId);
  };

  return (
    <NoticeBell
      // Shortcut only; the agent screen is per-company and needs the company
      // selector, so it stays a page rather than moving into this panel.
      settingsHref="/agent-settings/profile"
      notices={notices}
      unread={unread}
      emailComposer={false}
      showCompany
      emptyBody={m.notice_empty_body_agent()}
      onMarkAllRead={() => submit("notice-mark-all-read")}
      onDismiss={(id) => submit("notice-dismiss", id)}
      onRemedy={onRemedy}
    />
  );
}
