// tests/unit/inspections/subtype-specials.spec.ts
import { describe, it, expect } from 'vitest';
import { resolveKitchenChain, resolveIndustrialSpecials } from '../../../server/lib/subtype-specials';

describe('commercial-kitchen chain', () => {
  it('mounts nothing when the flag is off', () => {
    expect(resolveKitchenChain({ hasCommercialKitchen: false })).toEqual({ sectionIds: [], subItemIds: [] });
    expect(resolveKitchenChain({})).toEqual({ sectionIds: [], subItemIds: [] });
  });

  it('mounts the full chain when the flag is on: cooking areas + grease trap + Type K/Ansul + walk-in', () => {
    const m = resolveKitchenChain({ hasCommercialKitchen: true });
    expect(m.sectionIds).toContain('cooking-areas');
    expect(m.subItemIds).toEqual(expect.arrayContaining([
      'grease-trap-interceptor',
      'type-k-extinguisher',
      'ansul-manual-actuator',
      'walk-in-cooler-freezer',
    ]));
  });
});

describe('industrial specials', () => {
  it('mounts dock leveler / 3-phase / ESFR sprinkler density when industrial', () => {
    const m = resolveIndustrialSpecials({ isIndustrial: true });
    expect(m.subItemIds).toEqual(expect.arrayContaining([
      'dock-leveler',
      'three-phase-service',
      'esfr-sprinkler-density',
    ]));
  });
  it('mounts nothing when not industrial', () => {
    expect(resolveIndustrialSpecials({})).toEqual({ sectionIds: [], subItemIds: [] });
  });
});
