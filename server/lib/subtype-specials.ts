/**
 * Commercial PCA Phase T — subtype-special chains driven by Building Profile
 * flags. The commercial-kitchen toggle mounts the whole hospitality chain at
 * once (Cooking Areas + grease trap + Type K/Ansul + walk-in); industrial
 * mounts dock leveler / 3-phase / ESFR. Server-only. See "Commercial PCA Phase T".
 */
export interface SubtypeSpecialMounts {
  sectionIds: string[];
  subItemIds: string[];
}

const EMPTY: SubtypeSpecialMounts = { sectionIds: [], subItemIds: [] };

export function resolveKitchenChain(flags: { hasCommercialKitchen?: boolean }): SubtypeSpecialMounts {
  if (!flags.hasCommercialKitchen) return { ...EMPTY };
  return {
    // Cooking Areas is a genuine ComSOP §6.5.13 chapter (attribution in system-coverage.ts)
    sectionIds: ['cooking-areas'],
    subItemIds: [
      'grease-trap-interceptor',   // plumbing
      'type-k-extinguisher',       // life safety
      'ansul-manual-actuator',     // life safety
      'walk-in-cooler-freezer',    // refrigeration
    ],
  };
}

export function resolveIndustrialSpecials(flags: { isIndustrial?: boolean }): SubtypeSpecialMounts {
  if (!flags.isIndustrial) return { ...EMPTY };
  return {
    sectionIds: [],
    subItemIds: [
      'dock-leveler',
      'three-phase-service',
      'esfr-sprinkler-density',
    ],
  };
}
