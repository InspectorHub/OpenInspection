import { useFetcher } from "react-router";
import {
  NotificationPreferences,
  type AlwaysSentItem,
  type ChannelId,
  type ChoiceRow,
} from "~/components/notifications/NotificationPreferences";
import { SmsConsentBlock, type SmsConsent } from "~/components/notifications/SmsConsentBlock";
import { useNotificationSaveToast } from "~/hooks/useNotificationSaveToast";
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
  alwaysSent, youChoose, error, smsConsent, manageTextsHref,
}: {
  alwaysSent: AlwaysSentItem[];
  youChoose: ChoiceRow[];
  error: string | null;
  /** Null when this reader has no SMS identity — the block does not render. */
  smsConsent: SmsConsent | null;
  manageTextsHref?: string | undefined;
}) {
  const fetcher = useFetcher<{ ok?: boolean; intent?: string; error?: string }>();
  const result = fetcher.data?.intent === "notification-preference" || fetcher.data?.intent === "notification-bulk"
    ? fetcher.data : null;
  const saveError = result && result.ok === false ? result.error : null;
  useNotificationSaveToast({ data: result, failed: !!saveError, error: saveError });

  // "saved" persists after the fetcher goes idle, so the confirmation is still
  // on screen when the reader looks up from the switch they just moved.
  const status = fetcher.state !== "idle" ? "saving" as const : "idle" as const;

  function bulk(enabled: boolean, scope: { channel?: ChannelId; classId?: string }) {
    fetcher.submit(
      {
        intent: "notification-bulk",
        action: enabled ? "enable" : "disable",
        ...(scope.channel ? { channel: scope.channel } : {}),
        ...(scope.classId ? { classId: scope.classId } : {}),
      },
      { method: "post" },
    );
  }

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
      {/* Only the LOAD failure stays inline — it explains why the grid below
          is missing, so it belongs where the grid would have been. */}
      {error && <p className="text-[13px] text-ih-bad-fg">{error}</p>}
      <NotificationPreferences
        alwaysSent={alwaysSent}
        youChoose={youChoose}
        onChange={save}
        busy={fetcher.state !== "idle"}
        status={status}
        onBulk={bulk}
      />
      {smsConsent && (
        // Stopping texts is BOTH a consent act and a cascade over the Text
        // column — one request, so the two can never disagree.
        <SmsConsentBlock
          consent={smsConsent}
          manageHref={manageTextsHref}
          onStop={() => bulk(false, { channel: "sms" })}
          busy={fetcher.state !== "idle"}
        />
      )}
    </div>
  );
}
