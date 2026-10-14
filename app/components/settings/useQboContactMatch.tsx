import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useGuardedSubmit } from "~/hooks/useGuardedSubmit";
import { m } from "~/paraglide/messages";
import { QboCustomerLinkDialog, type CustomerLinkResult, type CustomerSearchRow } from "~/components/settings/QboCustomerLinkDialog";
import type { CustomerMatchActionData } from "~/lib/qbo-customer-match.server";
import type { QBOSyncErrorSummary } from "../../../server/services/qbo/api-base";

/**
 * Submits to the route's action and hands back a promise for what it answered.
 *
 * The dialog is written against `search(q) => Promise` and `link(id) => Promise`
 * so it never fetches; the route's fetchers answer through `data` instead. This
 * joins the two. The submit itself goes through `useGuardedSubmit`, which keeps
 * a second call out while the first is in flight.
 */
function useActionCall() {
  // submit-guard-allow-no-busy: the dialog's own searching/linking state drives its pending buttons, and nothing else reads these fetchers.
  const { fetcher, submit } = useGuardedSubmit<CustomerMatchActionData>();
  const waiting = useRef<((data: CustomerMatchActionData | undefined) => void) | null>(null);

  useEffect(() => {
    if (fetcher.state !== "idle" || !waiting.current) return;
    const resolve = waiting.current;
    waiting.current = null;
    resolve(fetcher.data);
  }, [fetcher.state, fetcher.data]);

  return useCallback(
    (fields: Record<string, string>) =>
      new Promise<CustomerMatchActionData | undefined>((resolve) => {
        // A refused submit must not take over the slot of the call still in flight.
        if (submit(fields, { method: "POST" })) waiting.current = resolve;
        else resolve(undefined);
      }),
    [submit],
  );
}

/**
 * The "match this contact to a QuickBooks customer" flow for the books-health
 * panel: `open(error)` is what the row button calls, `dialog` is rendered once.
 * A successful match closes the dialog; the action's revalidation drops the resolved row.
 */
export function useQboContactMatch(): { open: (error: QBOSyncErrorSummary) => void; dialog: ReactNode } {
  const [target, setTarget] = useState<QBOSyncErrorSummary | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const call = useActionCall();
  const linkCall = useActionCall();

  const search = useCallback(
    async (q: string): Promise<CustomerSearchRow[] | { error: "rate_limited" | "not_connected" | "other" }> => {
      const answer = await call({ intent: "qbo-search-customers", q });
      const outcome = answer?.search;
      if (!outcome) return { error: "other" };
      return outcome.ok ? outcome.customers : { error: outcome.error };
    },
    [call],
  );

  const contactId = target?.oiId ?? "";
  const link = useCallback(
    async (qboCustomerId: string): Promise<CustomerLinkResult> => {
      const answer = await linkCall({ intent: "qbo-link-customer", contactId, qboCustomerId });
      return answer?.linked ?? { ok: false, reason: "other" };
    },
    [linkCall, contactId],
  );

  const dialog = target ? (
    <QboCustomerLinkDialog
      open={isOpen}
      // The row carries the contact's id, not its name; the dialog says "this contact".
      contact={{ id: target.oiId, name: m.settings_qbo_match_this_contact() }}
      currentLink={null}
      onClose={() => setIsOpen(false)}
      // The link action's own completion revalidates the page's loader, which
      // is what removes the resolved row.
      onLinked={() => setIsOpen(false)}
      search={search}
      link={link}
    />
  ) : null;

  return {
    open: (error) => {
      setTarget(error);
      setIsOpen(true);
    },
    dialog,
  };
}
