import { Link } from "react-router";
import { buttonClasses } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

/**
 * Communication's pointer to where email and SMS delivery are set up. This page
 * is about how messages read and when they go out; the accounts and keys that
 * send them live in Integrations and are never shown here.
 */
export function DeliveryAccountsRow() {
  return (
    <section aria-labelledby="delivery-accounts-heading" className="bg-ih-bg-card border border-ih-border rounded-ih-card p-5 space-y-3">
      <div>
        <h3 id="delivery-accounts-heading" className="text-sm font-bold text-ih-fg-1">{m.settings_comms_delivery_heading()}</h3>
        <p className="text-xs text-ih-fg-3 mt-0.5">{m.settings_comms_delivery_desc()}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link to="/settings/integrations/email" className={buttonClasses({ variant: "secondary", size: "sm" })}>
          {m.settings_comms_delivery_email_link()}
        </Link>
        <Link to="/settings/integrations/sms" className={buttonClasses({ variant: "secondary", size: "sm" })}>
          {m.settings_comms_delivery_sms_link()}
        </Link>
      </div>
    </section>
  );
}
