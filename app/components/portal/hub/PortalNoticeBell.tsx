/**
 * The client Hub's Notices bell, wired.
 *
 * <NoticeBell> stays presentational and shared with the agent portal; this
 * thin wrapper owns the three writes and the two remedies, which are the only
 * parts that differ per portal:
 *
 *  - "Turn on texts" asks the BFF for a freshly-minted opt-in link and then
 *    navigates. The token is not baked into the page on load: nobody who has
 *    not asked for the remedy should be carrying one around in their HTML.
 *  - "Tell us your new email" opens the Messages composer with a first line
 *    already written, because there is deliberately no self-service email
 *    change (portal access is keyed on the address — see design §3.16).
 */
import { useEffect } from "react";
import { useNavigate, useRevalidator } from "react-router";
import { useGuardedSubmit } from "~/hooks/useGuardedSubmit";
import { m } from "~/paraglide/messages";
import { NoticeBell } from "~/components/notices/NoticeBell";
import { hubSectionNavHref } from "~/components/portal/ClientPortalHub";
import type { NoticeRowData, NoticeRemedy } from "~/lib/notice-view";

export function PortalNoticeBell({
  notices,
  unread,
  ctx,
  settingsHref,
}: {
  notices: NoticeRowData[];
  unread: number;
  ctx: { tenant: string; inspectionId: string; token: string };
  /** The Hub's own `?section=notifications` — the client's only "about me"
   *  surface, since the Hub itself is organised per inspection. */
  settingsHref?: string;
}) {
  // #106 - dismiss, mark-all-read and the opt-in link all write.
  const { fetcher, submit: guardedSubmit, busy } =
    useGuardedSubmit<{ ok?: boolean; intent?: string; url?: string }>();
  const revalidator = useRevalidator();
  const navigate = useNavigate();

  // The opt-in link is minted on demand, so the navigation happens when the
  // answer arrives rather than on the click.
  //
  // A FULL navigation, not a client-side one: the sealed token is
  // `<tenantId>~t1:<iv>:<cipher>` and its base64 can contain "/", so once the
  // router decodes the path the token reads as two segments and matches no
  // route — the URL changes and the page does not. Verified in the browser.
  // The server matches it correctly, and the opt-in page is a public flow of
  // its own rather than a step inside the Hub, so leaving the SPA is right.
  useEffect(() => {
    const data = fetcher.data;
    if (data?.ok && data.intent === "notice-optin-link" && data.url) {
      window.location.assign(data.url);
    }
  }, [fetcher.data]);

  // A dismissal or a mark-all changes the list the loader served, so pull it
  // again rather than mutating a local copy that can disagree with the server.
  useEffect(() => {
    const data = fetcher.data;
    if (data?.ok && (data.intent === "notice-dismiss" || data.intent === "notice-mark-all-read")) {
      revalidator.revalidate();
    }
    // revalidator identity changes on every state transition; keying on the
    // fetcher payload alone is what makes this fire once per completed write.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data]);

  const submit = (intent: string, noticeId?: string) =>
    guardedSubmit({ intent, ...(noticeId ? { noticeId } : {}) }, { method: "post" });

  const onRemedy = (remedy: NoticeRemedy) => {
    if (remedy.kind === "sms-consent") {
      submit("notice-optin-link", remedy.noticeId);
      return;
    }
    navigate(
      `${hubSectionNavHref("messages", ctx)}${hubSectionNavHref("messages", ctx).includes("?") ? "&" : "?"}prefill=email`,
    );
  };

  return (
    <NoticeBell
      settingsHref={settingsHref}
      notices={notices}
      unread={unread}
      emailComposer
      emptyBody={m.notice_empty_body()}
      onMarkAllRead={() => submit("notice-mark-all-read")}
      onDismiss={(id) => submit("notice-dismiss", id)}
      onRemedy={onRemedy}
      busy={busy}
    />
  );
}
