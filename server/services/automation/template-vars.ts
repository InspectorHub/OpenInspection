import { reportUrl } from '../../lib/public-urls';
import type { inspections, tenants } from '../../lib/db/schema';

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
 */
export function buildBaseTemplateVars(
    inspection: typeof inspections.$inferSelect,
    tenant: typeof tenants.$inferSelect,
    appName: string,
    appHost: string,
): Record<string, string> {
    return {
        client_name:      inspection.clientName ?? '',
        property_address: inspection.propertyAddress,
        scheduled_date:   inspection.date,
        report_url:       reportUrl(appHost, tenant.slug, inspection.id),
        company_name:     appName,
    };
}
