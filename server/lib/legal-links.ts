/**
 * Generic legal-document links for self-host operators (and the hosted SaaS):
 * when TERMS_URL / PRIVACY_URL are configured, account-creating public forms
 * require an acceptance checkbox and public pages link the privacy notice.
 * Unset (the open-source default) = the whole feature is off.
 *
 * NOTE: version resolution is deliberately NOT done here — acceptance records
 * only the URLs + timestamp; whoever owns the documents (the operator, or the
 * hosted platform's terms registry) resolves "which version was in force at
 * that moment" from their own document history. Zero runtime coupling.
 */
export interface LegalLinks { termsUrl?: string | undefined; privacyUrl?: string | undefined; }

export function getLegalLinks(env: { TERMS_URL?: string; PRIVACY_URL?: string }): LegalLinks | null {
    const termsUrl = env.TERMS_URL?.trim() || undefined;
    const privacyUrl = env.PRIVACY_URL?.trim() || undefined;
    if (!termsUrl && !privacyUrl) return null;
    return { termsUrl, privacyUrl };
}

/**
 * Returns the canonical per-tenant legal-page URL that managed compliance
 * registrations (TFV/A2P) and booking opt-in links should point at.
 * Both the orchestrator and the booking loader call this helper so the URL
 * shape lives in exactly one place.
 */
export function tenantLegalUrl(
    appBaseUrl: string,
    slug: string,
    doc: 'privacy' | 'terms',
): string {
    // Strip trailing slash from the base URL to avoid double-slash paths.
    return `${appBaseUrl.replace(/\/$/, '')}/legal/${slug}/${doc}`;
}

export function buildTermsAcceptedBlob(
    links: LegalLinks,
    req: { ip?: string | undefined; country?: string | undefined },
): { at: string; ip?: string; country?: string; termsUrl?: string; privacyUrl?: string } {
    return {
        at: new Date().toISOString(),
        ...(req.ip ? { ip: req.ip } : {}),
        ...(req.country ? { country: req.country } : {}),
        ...(links.termsUrl ? { termsUrl: links.termsUrl } : {}),
        ...(links.privacyUrl ? { privacyUrl: links.privacyUrl } : {}),
    };
}
