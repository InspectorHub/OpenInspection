/**
 * The inspector portal's Notices bell — the third consumer of <NoticeBell>.
 *
 * Reads on mount rather than from a loader: the sidebar renders on every page
 * of the app, and threading an inbox through the layout loader would put a
 * query on every navigation whether or not anyone looks at the bell. One
 * fetcher load per page is the same cost and stays local to this component.
 *
 * Staff notices carry no channels and therefore no remedies — there was no
 * delivery to fix. `onRemedy` is a no-op rather than an optional prop so the
 * shared component keeps ONE contract across all three portals.
 */
import { useEffect } from "react";
import { useFetcher } from "react-router";
import { m } from "~/paraglide/messages";
import { NoticeBell } from "./NoticeBell";
import type { StaffNoticesPayload } from "~/routes/resources/staff-notices";

const EMPTY: StaffNoticesPayload = { notices: [], unread: 0 };

export function StaffNoticeBell() {
  const load = useFetcher<StaffNoticesPayload>();
  const write = useFetcher<{ ok?: boolean }>();

  useEffect(() => {
    if (load.state === "idle" && !load.data) load.load("/resources/staff-notices");
    // Load once per mount; `load` identity changes on every state transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A write changed the list the read returned, so pull it again rather than
  // patching a local copy that can disagree with the server.
  useEffect(() => {
    if (write.data?.ok) load.load("/resources/staff-notices");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [write.data]);

  const data = load.data ?? EMPTY;
  const submit = (intent: string, noticeId?: string) =>
    write.submit(
      { intent, ...(noticeId ? { noticeId } : {}) },
      { method: "post", action: "/resources/staff-notices" },
    );

  return (
    <NoticeBell
      notices={data.notices}
      unread={data.unread}
      /* The bell lives in the sidebar, so the panel must open INTO the
         content area; the header-bell default would send it off-screen. */
      align="left"
      emailComposer={false}
      emptyBody={m.notice_empty_body_staff()}
      onMarkAllRead={() => submit("notice-mark-all-read")}
      onDismiss={(id) => submit("notice-dismiss", id)}
      onRemedy={() => {}}
    />
  );
}
