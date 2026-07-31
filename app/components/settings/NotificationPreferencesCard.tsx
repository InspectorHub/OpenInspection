import { useFetcher } from "react-router";
import {
  NotificationPreferences,
  type AlwaysSentItem,
  type ChannelId,
  type ChoiceRow,
} from "~/components/notifications/NotificationPreferences";
import { m } from "~/paraglide/messages";

/**
 * The staff member's own notification settings, on Settings → Profile (§4.1).
 *
 * A card rather than a section inlined into the route, for two reasons that are
 * the same reason: the route is already long, and this is the third surface to
 * render the same model. The shared component below decides what a reader sees;
 * this only supplies the persistence, which is the one part each surface has to
 * own — staff post to their own route's action, an agent's write also names a
 * company, and the client portal authenticates by token.
 *
 * Staff have very little here on purpose. Almost everything they receive is
 * account access, a money or legal record, or office dispatch an individual is
 * not allowed to silence for the whole company (§2.5) — so the "always sent"
 * section carries the page and the empty-ish choose list is the honest answer,
 * not a bug.
 */
export function NotificationPreferencesCard({
  alwaysSent, youChoose, loadError,
}: {
  alwaysSent: AlwaysSentItem[];
  youChoose: ChoiceRow[];
  /** The read failed. Distinct from "nothing to show" — see below. */
  loadError: string | null;
}) {
  const fetcher = useFetcher<{ success?: boolean; error?: string; intent?: string }>();
  const result = fetcher.data?.intent === "save-notification" ? fetcher.data : null;
  const error = result && result.success === false ? result.error : null;

  // "saved" persists after the fetcher goes idle, so the confirmation is still
  // on screen when the reader looks up from the switch they just moved.
  const status = fetcher.state !== "idle" ? "saving" as const
    : error ? "idle" as const
      : fetcher.data ? "saved" as const : "idle" as const;

  function save(classId: string, channel: ChannelId, enabled: boolean) {
    fetcher.submit(
      { intent: "save-notification", classId, channel, enabled: String(enabled) },
      { method: "post" },
    );
  }

  return (
    <section className="bg-ih-bg-card border border-ih-border rounded-xl p-6">
      <p className="text-[11px] font-bold text-ih-fg-4 uppercase tracking-widest mb-1">
        {m.settings_notifications_eyebrow()}
      </p>
      <h2 className="text-sm font-bold text-ih-fg-1 mb-1">{m.settings_notifications_heading()}</h2>
      <p className="text-[13px] text-ih-fg-3 mb-4">{m.settings_notifications_desc()}</p>
      {error && <p className="text-[12px] text-ih-bad-fg mb-3">{error}</p>}
      {loadError ? (
        // Never render the two counts when the read failed. "0 notifications
        // you cannot switch off" is a confident false answer, and the count is
        // the loudest thing on the card.
        <p className="text-[13px] text-ih-bad-fg">{loadError}</p>
      ) : (
        <NotificationPreferences
          alwaysSent={alwaysSent}
          youChoose={youChoose}
          onChange={save}
          busy={fetcher.state !== "idle"}
          status={status}
        />
      )}
    </section>
  );
}
