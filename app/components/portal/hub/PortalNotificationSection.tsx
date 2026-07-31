import { useFetcher } from "react-router";
import {
  NotificationPreferences,
  type AlwaysSentItem,
  type ChannelId,
  type ChoiceRow,
} from "~/components/notifications/NotificationPreferences";
import { m } from "~/paraglide/messages";

/**
 * The client's own notification settings, inside the Hub (spec §4.1).
 *
 * Reached from the BELL, not from the section nav — the eight tabs are facts
 * about this inspection and this is a fact about the reader. The inspection in
 * the URL is only where they happened to be standing when they asked.
 *
 * Same component as staff and agent see (CLAUDE.md, Cross-Portal Reuse); what
 * differs is only who is asked and how the write is authenticated, which is the
 * route's job rather than this one's.
 */
export function PortalNotificationSection({
  alwaysSent, youChoose, error,
}: {
  alwaysSent: AlwaysSentItem[];
  youChoose: ChoiceRow[];
  error: string | null;
}) {
  const fetcher = useFetcher<{ ok?: boolean; intent?: string; error?: string }>();
  const result = fetcher.data?.intent === "notification-preference" ? fetcher.data : null;
  const saveError = result && result.ok === false ? result.error : null;

  // "saved" persists after the fetcher goes idle, so the confirmation is still
  // on screen when the reader looks up from the switch they just moved.
  const status = fetcher.state !== "idle" ? "saving" as const
    : saveError ? "idle" as const
      : fetcher.data ? "saved" as const : "idle" as const;

  function save(classId: string, channel: ChannelId, enabled: boolean) {
    fetcher.submit(
      { intent: "notification-preference", classId, channel, enabled: String(enabled) },
      { method: "post" },
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-ih-fg-1">{m.portal_notif_heading()}</h1>
        <p className="text-[13px] text-ih-fg-3 mt-1 max-w-prose">{m.portal_notif_desc()}</p>
      </div>
      {(error || saveError) && (
        <p className="text-[13px] text-ih-bad-fg">{error ?? saveError}</p>
      )}
      <NotificationPreferences
        alwaysSent={alwaysSent}
        youChoose={youChoose}
        onChange={save}
        busy={fetcher.state !== "idle"}
        status={status}
      />
    </div>
  );
}
