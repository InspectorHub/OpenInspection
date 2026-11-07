/**
 * Free-tier usage quotas — shown in place of the New Inspection wizard's
 * body/footer when the create POST comes back 402 QUOTA_EXHAUSTED.
 * `billingPortalUrl` is null when the deployment has no configured billing
 * portal to link to (the CTA is hidden in that case; the message still
 * explains what happened).
 */
import { Button, buttonClasses } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

export function QuotaExceededPanel({
  billingPortalUrl,
  onClose,
}: {
  billingPortalUrl: string | null;
  onClose: () => void;
}) {
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 overflow-y-auto px-6 py-8 text-center">
        <p className="text-[14px] font-bold text-ih-fg-1 mb-2">{m.newinsp_quota_title()}</p>
        <p className="text-[13px] text-ih-fg-3 max-w-[38ch] mx-auto">
          {m.newinsp_quota_body()}
        </p>
      </div>
      <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-ih-border">
        <Button variant="secondary" onClick={onClose}>
          {m.common_close()}
        </Button>
        {billingPortalUrl && (
          <a
            href={billingPortalUrl}
            className={buttonClasses({ variant: "primary", size: "md" })}
          >
            {m.newinsp_quota_subscribe()}
          </a>
        )}
      </div>
    </div>
  );
}
