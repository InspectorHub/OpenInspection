import type { ReactNode } from "react";
import { Pill } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

/**
 * The account details (keys) section of a service page. Open while something is
 * still missing, folded once the details are complete, so a working service does
 * not put its keys in front of anyone. The summary always says which it is.
 */
export function FoldedAccountDetails({ complete, children }: { complete: boolean; children: ReactNode }) {
  return (
    <details open={!complete} className="group" data-testid="account-details">
      <summary className="flex cursor-pointer items-center gap-2 py-2 text-sm font-bold text-ih-fg-1">
        <span>{m.integrations_delivery_keys_summary()}</span>
        <Pill tone={complete ? "sat" : "warning"}>
          {complete ? m.integrations_delivery_keys_saved() : m.integrations_delivery_keys_incomplete()}
        </Pill>
      </summary>
      <div className="mt-2 space-y-ih-list">{children}</div>
    </details>
  );
}
