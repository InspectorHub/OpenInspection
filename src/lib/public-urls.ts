/**
 * URL builders for tenant-scoped public routes. Uniform shape across
 * standalone / saas-shared / saas-silo: /<prefix>/<tenant>/<slug-or-id>.
 *
 * Caller supplies the host. For request-relative links use
 *   c.req.header('host') with deriveBaseUrl(c)
 * For canonical links (emails / PDFs) use env.APP_BASE_URL.
 */

function scheme(host: string): string {
    return host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https';
}

function joinUrl(host: string, path: string): string {
    return `${scheme(host)}://${host}${path}`;
}

export function bookingUrl(host: string, tenantSlug: string, inspectorSlug: string): string {
    return joinUrl(host, `/book/${tenantSlug}/${inspectorSlug}`);
}

export function embedBookingUrl(host: string, tenantSlug: string, inspectorSlug: string): string {
    return joinUrl(host, `/embed/book/${tenantSlug}/${inspectorSlug}`);
}

export function inspectorProfileUrl(host: string, tenantSlug: string, inspectorSlug: string): string {
    return joinUrl(host, `/inspector/${tenantSlug}/${inspectorSlug}`);
}

export function inspectorCalendarUrl(host: string, tenantSlug: string, inspectorSlug: string): string {
    return joinUrl(host, `/inspector/${tenantSlug}/${inspectorSlug}/calendar.ics`);
}

export function reportUrl(host: string, tenantSlug: string, inspectionId: string): string {
    return joinUrl(host, `/report/${tenantSlug}/${inspectionId}`);
}

export function signUrl(host: string, tenantSlug: string, inspectionId: string): string {
    return joinUrl(host, `/sign/${tenantSlug}/${inspectionId}`);
}

export function agreementSignUrl(host: string, tenantSlug: string, token: string): string {
    return joinUrl(host, `/agreements/sign/${tenantSlug}/${token}`);
}

export function agreementSignPath(tenantSlug: string, token: string): string {
    return `/agreements/sign/${tenantSlug}/${token}`;
}

export function m2mAgreementRenderUrl(host: string, tenantSlug: string, token: string): string {
    return joinUrl(host, `/m2m/agreement-render/${tenantSlug}/${token}`);
}
