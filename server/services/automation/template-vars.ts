import { reportUrl } from '../../lib/public-urls';
import { formatScheduledDate, type ScheduledDateDisplay } from '../../lib/inspection/scheduled-date-display';
import type { tenants } from '../../lib/db/schema';
import type { FlushInspection } from './shared';

/**
 * Shared template-variable construction for automation delivery.
 *
 * The email path (flush) and the SMS path (deliverSms) each built a `vars` map
 * for {{...}} interpolation that opened with the SAME five fields, constructed
 * byte-identically:
 *
 *   client_name      = inspection.clientName ?? ''
 *   property_address = inspection.propertyAddress
 *   scheduled_date   = inspection.date
 *   report_url       = reportUrl(appHost, tenant.slug, inspection.id)
 *   company_name     = appName
 *
 * This collapses that duplication ONCE. Both callers spread the result and then
 * add their channel-specific extras (email: inspector_name / invoice_url /
 * payment_url / event_* ; sms: company_phone) exactly as before — so each
 * channel's final variable map is unchanged.
 *
 * `scheduled_date` is the exception to "unchanged": it used to be the raw
 * column, which for a booking is `2026-09-16T08:00:00Z`. The reasoning for
 * formatting the existing token instead of adding a second one is written once,
 * at the sibling resolution point in `./notice-wording.ts`; this call site
 * follows it so a tenant's `{{scheduled_date}}` means the same thing in an
 * email, a text message and a notice.
 */
export function buildBaseTemplateVars(
    inspection: FlushInspection,
    tenant: typeof tenants.$inferSelect,
    appName: string,
    appHost: string,
    /** Workspace locale + timezone; see `server/lib/tenant-display.ts`. */
    display: ScheduledDateDisplay,
    // `summary` is the re-publish change note from the latest report_version;
    // only report.amended templates reference {{summary}}. Absent → '' (the
    // interpolate helper already renders missing tokens blank, so passing it
    // explicitly just lets the amended mail carry the inspector's note).
    extra?: { summary?: string },
): Record<string, string> {
    return {
        client_name:      inspection.clientName ?? '',
        property_address: inspection.propertyAddress,
        scheduled_date:   formatScheduledDate(inspection.date, display),
        report_url:       reportUrl(appHost, tenant.slug, inspection.id),
        company_name:     appName,
        summary:          extra?.summary ?? '',
    };
}
