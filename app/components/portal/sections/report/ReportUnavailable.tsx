/**
 * <ReportUnavailable> — what the reader sees instead of a report.
 *
 * Three outcomes, one place, because choosing between them is the whole logic:
 *
 *  1. Not published yet — the report exists but the inspector has not released
 *     it. Nothing is wrong; say so plainly.
 *
 *  2. IA-36 ⑨ — "we took this link offline" (410) and "this link names
 *     nothing" (404) render the SAME page on purpose.
 *
 *     The reader cannot act on the difference and we cannot always tell them
 *     the truth anyway: rotating a link overwrites its row in place, so a
 *     recipient holding the superseded URL is indistinguishable from someone
 *     who mistyped one — both arrive as 404. Splitting the copy would mean
 *     confidently telling a legitimate client "no such report" when we in fact
 *     replaced their link ten minutes ago.
 *
 *     So the page states both possibilities and names the recovery path. The
 *     wire keeps 410 and 404 distinct — support and the audit trail need to
 *     know which happened even when the reader doesn't.
 *
 *  3. Anything else — a generic load failure.
 *
 * The caller renders this INSTEAD of the report, never alongside it.
 */
import { m } from "~/paraglide/messages";
import { ErrorState } from "~/components/ErrorState";
import type { TenantBrand } from "~/lib/brand";

export interface ReportUnavailableProps {
  /** The loader's error string (non-null, or the report would have rendered). */
  error: string;
  notPublished: boolean;
  /** The link was real but has expired or been revoked (API 410). */
  linkInactive?: boolean;
  brand: TenantBrand;
}

export function ReportUnavailable({ error, notPublished, linkInactive, brand }: ReportUnavailableProps) {
  if (notPublished) {
    return (
      <ErrorState
        title={m.report_view_not_published_title()}
        message={m.report_view_not_published_message()}
      />
    );
  }
  const notFound = error === "Report not found";
  if (notFound || linkInactive) {
    // Name the company and give a channel. "Ask your inspector" is not
    // actionable to someone who received one email months ago and no longer
    // remembers who sent it.
    const company = brand?.companyName;
    return (
      <ErrorState
        title={m.report_link_inactive_title()}
        message={
          company
            ? m.report_link_inactive_message_company({ company })
            : m.report_link_inactive_message()
        }
        contacts={{
          email: brand?.supportEmail,
          phone: brand?.companyPhone,
        }}
      />
    );
  }
  return (
    <ErrorState
      title={m.report_view_unavailable_title()}
      message={m.report_view_load_error()}
    />
  );
}
