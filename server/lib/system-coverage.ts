/**
 * Commercial PCA Phase T — system coverage registry + standard attribution.
 *
 * CORRECTNESS-CRITICAL: attribution feeds the Phase M conformance statement.
 * Some chapters real reports carry are ASTM E2018 chapters / ComSOP sub-items,
 * NOT ComSOP §6.5 chapters — they must be cited as ASTM, never ComSOP:
 *   - Vertical Transportation  -> ASTM E2018 §7   (ComSOP §6.5.11 sub-item)
 *   - Loading Docks & OH Doors  -> ASTM E2018 interior/structural (ComSOP §6.5.11)
 *   - Site / Flatwork          -> ASTM E2018 §5   (§5.4 Flatwork; ComSOP §6.5.2)
 * Only these are genuine ComSOP §6.5 chapters:
 *   - Wood Decks & Balconies   -> ComSOP §6.5.3
 *   - Cooking Areas            -> ComSOP §6.5.13  (kitchen-flag gated)
 * Server-only (do not import from app/). See "Commercial PCA Phase T".
 */
type CoverageStandard =
  | { standard: 'ASTM E2018'; section: string }
  | { standard: 'CCPIA ComSOP'; section: string };

export interface ProfileFlags {
  hasCommercialKitchen?: boolean;
  isIndustrial?: boolean;
  isMixedUse?: boolean;
}

export interface SystemCoverage {
  id: string;
  title: string;
  attribution: CoverageStandard;
  subtypes: string[];
  requiresProfileFlag?: keyof ProfileFlags;
}

export const SYSTEM_COVERAGE: readonly SystemCoverage[] = [
  {
    id: 'vertical-transportation',
    title: 'Vertical Transportation',
    attribution: { standard: 'ASTM E2018', section: '§7' },
    subtypes: ['office', 'retail', 'hospitality', 'institutional'],
  },
  {
    id: 'loading-docks',
    title: 'Loading Docks & Overhead Doors',
    attribution: { standard: 'ASTM E2018', section: '§6 (Interior)' },
    subtypes: ['industrial', 'retail'],
    requiresProfileFlag: 'isIndustrial',
  },
  {
    id: 'site-flatwork',
    title: 'Site, Flatwork, Parking & Stormwater',
    attribution: { standard: 'ASTM E2018', section: '§5' },
    subtypes: ['office', 'retail', 'hospitality', 'industrial', 'institutional', 'mixed-use'],
  },
  {
    id: 'wood-decks-balconies',
    title: 'Wood Decks & Balconies',
    attribution: { standard: 'CCPIA ComSOP', section: '§6.5.3' },
    subtypes: ['hospitality', 'mixed-use'],
  },
  {
    id: 'cooking-areas',
    title: 'Cooking Areas',
    attribution: { standard: 'CCPIA ComSOP', section: '§6.5.13' },
    subtypes: ['hospitality', 'institutional', 'mixed-use', 'retail'],
    requiresProfileFlag: 'hasCommercialKitchen',
  },
] as const;

export function resolveSystemCoverage(subtype: string | null, flags: ProfileFlags): SystemCoverage[] {
  if (!subtype) return [];
  return SYSTEM_COVERAGE.filter((c) => {
    if (!c.subtypes.includes(subtype)) return false;
    if (c.requiresProfileFlag && !flags[c.requiresProfileFlag]) return false;
    return true;
  });
}
