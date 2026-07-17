/**
 * Shown when a non-admin (inspector / agent) reaches a company-only settings
 * page directly. The server still enforces RBAC on the underlying API; this is
 * the friendly UI face of that block.
 */
import { m } from "~/paraglide/messages";

export function AccessDenied() {
  return (
    <div className="bg-ih-bg-card border border-ih-border rounded-lg p-8 text-center">
      <p className="text-ih-fg-1 font-semibold">{m.access_denied_title()}</p>
      <p className="text-ih-fg-3 text-[13px] mt-1">
        {m.access_denied_body()}
      </p>
    </div>
  );
}
