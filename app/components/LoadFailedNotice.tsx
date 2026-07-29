import { Banner } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

/**
 * "This did not load" — said out loud, so it is never mistaken for "there is
 * nothing here" (IA-118).
 *
 * A loader that catches a failure into an empty array hands the page a value it
 * cannot tell apart from a real empty result, and every empty state in this app
 * is phrased as a conclusion: "No contacts yet", "You're all caught up", "No
 * repair items". The page then states that conclusion with full confidence. The
 * instances found so far all failed in the dangerous direction — a contact who
 * held two live report links was described as unable to open any, an operator
 * auditing third-party access was told nobody had any, and an owner lost their
 * management controls because a roster request timed out.
 *
 * One component rather than a message key per page: the sentence is the same
 * everywhere, and the cost of adding it per-page is exactly what stopped it
 * being added. Pass `what` when a page can name the thing more usefully than
 * "this list".
 */
export function LoadFailedNotice({ what }: { what?: string }) {
  return (
    <Banner tone="danger">
      {what
        ? m.load_failed_named({ what })
        : m.load_failed_generic()}
    </Banner>
  );
}
