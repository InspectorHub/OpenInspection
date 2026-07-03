/**
 * Free-tier usage quotas — shown in place of the New Inspection wizard's
 * body/footer when the create POST comes back 402 QUOTA_EXHAUSTED.
 * `billingPortalUrl` is null when the deployment has no configured billing
 * portal to link to (the CTA is hidden in that case; the message still
 * explains what happened).
 */
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
        <p className="text-[14px] font-bold text-ih-fg-1 mb-2">Free plan limit reached</p>
        <p className="text-[13px] text-ih-fg-3 max-w-[38ch] mx-auto">
          You&rsquo;ve used all 5 free inspections. Everything you created stays fully usable
          — subscribe to create new ones.
        </p>
      </div>
      <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-ih-border">
        <button onClick={onClose} className="h-8 px-4 rounded-md border border-ih-border text-[13px] font-medium text-ih-fg-3 hover:bg-ih-bg-muted">
          Close
        </button>
        {billingPortalUrl && (
          <a
            href={billingPortalUrl}
            className="h-8 px-4 inline-flex items-center justify-center rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600"
          >
            Subscribe
          </a>
        )}
      </div>
    </div>
  );
}
