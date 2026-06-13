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

/** Company-level embed — no inspector slug required (Task 10 / IA-26). */
export function embedBookingCompanyUrl(host: string, tenantSlug: string): string {
    return joinUrl(host, `/embed/${tenantSlug}`);
}

/**
 * Per-inspector embed deep link.
 * @deprecated the old path `/embed/book/<tenant>/<slug>` never existed.
 * The real route is `/embed/:tenant/:slug`. Kept for referential use;
 * prefer embedBookingCompanyUrl for new surfaces.
 */
export function embedBookingUrl(host: string, tenantSlug: string, inspectorSlug: string): string {
    return joinUrl(host, `/embed/${tenantSlug}/${inspectorSlug}`);
}

export function inspectorProfileUrl(host: string, tenantSlug: string, inspectorSlug: string): string {
    return joinUrl(host, `/inspector/${tenantSlug}/${inspectorSlug}`);
}

export function inspectorCalendarUrl(host: string, tenantSlug: string, inspectorSlug: string): string {
    return joinUrl(host, `/inspector/${tenantSlug}/${inspectorSlug}/calendar.ics`);
}

export function reportUrl(host: string, tenantSlug: string, inspectionId: string): string {
    // Canonical published-report renderer is `/report-view/` (report-card-stack):
    // the maintained, repair-item-aware view that matches the current
    // getReportData shape. The legacy `/report/` route now 302-redirects here
    // (preserving ?token=/?view=), so older emails + the PDF pipeline still work.
    return joinUrl(host, `/report-view/${tenantSlug}/${inspectionId}`);
}

/**
 * Public invoice payment page (Task 8 / #111). Unlike report/sign links this
 * route is keyed only by inspection id (`/r/:id/invoice`) — the public payment
 * page resolves the tenant itself — so no slug segment is required.
 */
export function paymentUrl(host: string, inspectionId: string): string {
    return joinUrl(host, `/r/${inspectionId}/invoice`);
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

/**
 * Track I-a Task 8 — combined Sign & pay link. Used in agreement-request
 * emails when the inspection requires payment AND has an outstanding invoice;
 * otherwise the standalone agreementSignUrl is used.
 */
export function checkoutUrl(host: string, tenantSlug: string, token: string): string {
    return joinUrl(host, `/checkout/${tenantSlug}/${token}`);
}

/**
 * Track I-a — keyed by the stable envelope requestId (the legacy plaintext
 * `token` column is no longer distributed; signer tokens live per-signer).
 */
export function m2mAgreementRenderUrl(host: string, tenantSlug: string, requestId: string): string {
    return joinUrl(host, `/m2m/agreement-render/${tenantSlug}/${requestId}`);
}
