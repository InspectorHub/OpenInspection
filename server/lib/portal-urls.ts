// Unified client portal CTA URL builder. The hub lives at
// /portal/:tenant/i/:inspectionId?token=<portalAccessToken>&to=<section>.
export type PortalSection = 'overview' | 'report' | 'agreement' | 'payment' | 'progress' | 'messages' | 'repair';
export function buildPortalUrl(
    baseUrl: string, tenantSlug: string, inspectionId: string, token: string, section: PortalSection = 'overview',
): string {
    const base = baseUrl.replace(/\/$/, '');
    let url = `${base}/portal/${encodeURIComponent(tenantSlug)}/i/${encodeURIComponent(inspectionId)}?token=${encodeURIComponent(token)}`;
    if (section !== 'overview') url += `&to=${encodeURIComponent(section)}`;
    return url;
}
