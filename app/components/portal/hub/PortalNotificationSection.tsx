import { NotificationSettings } from "~/components/notifications/NotificationSettings";
import type { AlwaysSentItem, ChoiceRow } from "~/components/notifications/NotificationPreferences";
import type { SmsConsent } from "~/components/notifications/SmsConsentBlock";
import { m } from "~/paraglide/messages";

/**
 * The client's own notification settings, inside the Hub (spec §4.1).
 *
 * Reached from the BELL, not from the section nav — the eight tabs are facts
 * about this inspection and this is a fact about the reader. The inspection in
 * the URL is only where they happened to be standing when they asked.
 *
 * A shell around the same surface staff and agents get (CLAUDE.md, Cross-Portal
 * Reuse). What differs is only the intent names this route's action listens
 * for, and that a client is the one audience who can GRANT consent inline —
 * agents and staff are implied and have nothing to grant.
 */
export function PortalNotificationSection({
  alwaysSent, youChoose, error, smsConsent, manageTextsHref,
}: {
  alwaysSent: AlwaysSentItem[];
  youChoose: ChoiceRow[];
  error: string | null;
  smsConsent: SmsConsent | null;
  manageTextsHref?: string | undefined;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-ih-fg-1">{m.portal_notif_heading()}</h1>
        <p className="text-[13px] text-ih-fg-3 mt-1 max-w-prose">{m.portal_notif_desc()}</p>
      </div>
      <NotificationSettings
        alwaysSent={alwaysSent}
        youChoose={youChoose}
        smsConsent={smsConsent}
        loadError={error}
        manageHref={manageTextsHref}
        intents={{
          save: "notification-preference",
          bulk: "notification-bulk",
          grant: "notification-sms-grant",
        }}
      />
    </div>
  );
}
