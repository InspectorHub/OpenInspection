/**
 * F3 seat quota — shown in place of the Invite modal's form the instant it
 * opens for a tenant already at its seat limit, instead of letting the
 * inviter fill in an email/role/permissions and only finding out on submit
 * (the server's 402 SEAT_LIMIT_REACHED, still the authoritative backstop for
 * races). Mirrors new-inspection/QuotaExceededPanel's at-open gate for the
 * inspection cap; copy tone matches SeatBanner's existing "reached your seat
 * limit" wording. `billingUrl` is undefined when no billing portal is
 * configured (the CTA is hidden in that case; the message still explains
 * what happened).
 */
import { Button, buttonClasses } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

export function SeatLimitPanel({
  used,
  max,
  billingUrl,
  onClose,
}: {
  used: number;
  max: number;
  billingUrl?: string;
  onClose: () => void;
}) {
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 overflow-y-auto px-6 py-8 text-center">
        <p className="text-[14px] font-bold text-ih-fg-1 mb-2">{m.modal_seatlimit_title()}</p>
        <p className="text-[13px] text-ih-fg-3 max-w-[38ch] mx-auto">
          {m.modal_seatlimit_body({ used, max })}
        </p>
      </div>
      <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-ih-border">
        <Button variant="secondary" onClick={onClose}>
          {m.common_close()}
        </Button>
        {billingUrl && (
          <a
            href={billingUrl}
            className={buttonClasses({ variant: "primary", size: "md" })}
          >
            {m.modal_seatlimit_upgrade()}
          </a>
        )}
      </div>
    </div>
  );
}
