/**
 * Tenant Privacy / Terms URLs — replaces Worker env PRIVACY_URL / TERMS_URL.
 *
 * Every tenant always has effective URLs:
 *   - hosted (default): `{base}/legal/{slug}/privacy` and `…/terms`
 *   - custom: tenant-supplied absolute URLs (both required; otherwise fall back
 *     to hosted so footers never go blank after a partial save)
 */
export type LegalMode = 'hosted' | 'custom';

export interface TenantLegalConfig {
    legalMode: LegalMode;
    customPrivacyUrl?: string | null;
    customTermsUrl?: string | null;
}

export interface LegalLinks {
    privacyUrl: string;
    termsUrl: string;
}

export function hostedLegalPaths(slug: string): { privacyPath: string; termsPath: string } {
    const s = encodeURIComponent(slug);
    return {
        privacyPath: `/legal/${s}/privacy`,
        termsPath: `/legal/${s}/terms`,
    };
}

export function resolveTenantLegalUrls(
    slug: string,
    baseUrl: string,
    cfg: TenantLegalConfig | null | undefined,
): LegalLinks {
    const base = baseUrl.replace(/\/$/, '');
    const paths = hostedLegalPaths(slug);
    const hosted: LegalLinks = {
        privacyUrl: `${base}${paths.privacyPath}`,
        termsUrl: `${base}${paths.termsPath}`,
    };

    if (!cfg || cfg.legalMode !== 'custom') return hosted;

    const privacy = cfg.customPrivacyUrl?.trim() || '';
    const terms = cfg.customTermsUrl?.trim() || '';
    if (!privacy || !terms) return hosted;
    return { privacyUrl: privacy, termsUrl: terms };
}

/** Stamp for users.terms_accepted when a public form records acceptance. */
export function buildTermsAcceptedBlob(
    links: LegalLinks,
    meta: { ip?: string; country?: string } = {},
): { at: string; ip?: string; country?: string; termsUrl: string; privacyUrl: string } {
    return {
        at: new Date().toISOString(),
        ...(meta.ip ? { ip: meta.ip } : {}),
        ...(meta.country ? { country: meta.country } : {}),
        termsUrl: links.termsUrl,
        privacyUrl: links.privacyUrl,
    };
}
