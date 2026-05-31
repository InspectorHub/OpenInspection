/**
 * Round-2 backlog G3 (Spectora §4.1, ITB UC-ITB-10) — referral source list.
 *
 * Seven seed values that ship with every workspace. Tenants can append
 * additional labels via Settings → Workspace → Referral Sources, persisted
 * to `tenant_configs.custom_referral_sources`.
 *
 * Keeping the seed list in a shared module avoids drifting copies between
 * the dropdown, the validation layer and the audit-export columns.
 */

export const SEED_REFERRAL_SOURCES = [
    'Realtor',
    'Past Client',
    'Google Search',
    'Facebook',
    'Yelp',
    'Walk-in',
    'Other',
] as const;

export type SeedReferralSource = typeof SEED_REFERRAL_SOURCES[number];

/**
 * Returns the effective referral-source list for a tenant: seeds first,
 * then any custom labels (de-duplicated, case-insensitive) appended in the
 * order the workspace configured them.
 */
export function resolveReferralSources(custom?: string[] | null | undefined): string[] {
    const seen = new Set<string>(SEED_REFERRAL_SOURCES.map(s => s.toLowerCase()));
    const out: string[] = [...SEED_REFERRAL_SOURCES];
    for (const raw of custom ?? []) {
        const v = (raw ?? '').trim();
        if (!v) continue;
        const k = v.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(v);
    }
    return out;
}
