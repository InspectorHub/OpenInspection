/**
 * Commercial PCA Phase T — report tier model. The first cut assumed a single
 * `pca_enabled` boolean, but that field was NEVER built — `report_tier` is a
 * clean introduction, not a migration. Tier is meaningful ONLY for commercial
 * inspections; residential/multi-unit ignore it (resolver returns null).
 *
 * Default policy: a commercial inspection is `light_commercial` unless the
 * inspector explicitly elevates it to `full_pca`. See the "Commercial PCA
 * Phase T" spec: "auto light, user elevates."
 */
export type ReportTier = 'light_commercial' | 'full_pca';

export const REPORT_TIERS: readonly ReportTier[] = ['light_commercial', 'full_pca'] as const;

export interface ResolveReportTierInput {
  propertyType?: string | null;
  /** Explicit value stored on inspections.report_tier (wins when present). */
  storedTier?: ReportTier | null;
}

export function resolveReportTier(input: ResolveReportTierInput): ReportTier | null {
  if (input.propertyType !== 'commercial') return null;
  if (input.storedTier === 'light_commercial' || input.storedTier === 'full_pca') {
    return input.storedTier;
  }
  return 'light_commercial';
}
