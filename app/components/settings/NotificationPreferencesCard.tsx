import { NotificationSettings } from "~/components/notifications/NotificationSettings";
import type { AlwaysSentItem, ChoiceRow } from "~/components/notifications/NotificationPreferences";
import type { SmsConsent } from "~/components/notifications/SmsConsentBlock";
import { useDisplayLocale } from "~/hooks/useSessionContext";
import { m } from "~/paraglide/messages";

/**
 * The staff member's own notification settings, on Settings -> Profile (§4.1).
 *
 * A shell around the shared surface: everything a reader interacts with lives
 * in `<NotificationSettings>`, and all this adds is the card chrome and the
 * intent names this route's action listens for.
 *
 * Staff have very little to choose here on purpose. Almost everything they
 * receive is account access, a money or legal record, or office dispatch an
 * individual is not allowed to silence for the whole company (§2.5) — so the
 * "always sent" section carries the page and the short choose list is the
 * honest answer, not a bug.
 */
export function NotificationPreferencesCard({
  alwaysSent, youChoose, loadError, smsConsent,
}: {
  alwaysSent: AlwaysSentItem[];
  youChoose: ChoiceRow[];
  /** The read failed. Distinct from "nothing to show". */
  loadError: string | null;
  /**
   * Staff ARE a consent subject — a `users` row with `contact_id` null. They
   * are never granted (implied under account terms, like an agent), so the
   * block exists to give their STOP somewhere to land.
   */
  smsConsent: SmsConsent | null;
}) {
  const locale = useDisplayLocale();
  return (
    <section className="bg-ih-bg-card border border-ih-border rounded-xl p-6">
      <p className="text-[11px] font-bold text-ih-fg-3 uppercase tracking-widest mb-1">
        {m.settings_notifications_eyebrow()}
      </p>
      <h2 className="text-sm font-bold text-ih-fg-1 mb-1">{m.settings_notifications_heading()}</h2>
      <p className="text-[13px] text-ih-fg-3 mb-4">{m.settings_notifications_desc()}</p>
      <NotificationSettings
        alwaysSent={alwaysSent}
        youChoose={youChoose}
        smsConsent={smsConsent}
        loadError={loadError}
        locale={locale}
        intents={{
          save: "save-notification",
          bulk: "bulk-notification",
          grant: "grant-notification-sms",
        }}
      />
    </section>
  );
}
