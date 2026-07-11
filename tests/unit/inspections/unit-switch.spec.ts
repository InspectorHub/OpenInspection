import { describe, it, expect } from 'vitest';
import { planPromotion, rewriteKeysForPromotion, flattenUnitsToTagged } from '../../../server/lib/unit-switch';

describe('planPromotion', () => {
  it('returns location labels not already a unit', () => {
    expect(planPromotion(['101', '102', 'Roof'], ['101'])).toEqual(['102', 'Roof']);
  });
});

describe('rewriteKeysForPromotion', () => {
  const labelToUnitId = { '101': 'u1', '102': 'u2' };
  it('moves an entry whose included defects all resolve to one unit; idempotent', () => {
    const data = {
      '_default:kitchen:sink': { rating: 'd', tabs: { defects: [{ cannedId: 'c', included: true, location: '101' }] } },
      '_default:roof:flash':   { rating: 'd', tabs: { defects: [{ cannedId: 'c', included: true, location: 'Common' }] } },
    };
    const once = rewriteKeysForPromotion(data, labelToUnitId);
    expect(Object.keys(once).sort()).toEqual(['_default:roof:flash', 'u1:kitchen:sink']);
    // idempotent
    expect(rewriteKeysForPromotion(once, labelToUnitId)).toEqual(once);
  });

  it('keeps _default when included defects resolve to DIFFERENT units (ambiguous)', () => {
    const data = {
      '_default:kitchen:sink': { tabs: { defects: [{ included: true, location: '101' }, { included: true, location: '102' }] } },
    };
    expect(Object.keys(rewriteKeysForPromotion(data, labelToUnitId))).toEqual(['_default:kitchen:sink']);
  });

  it('keeps _default when a resolvable location is MIXED with an unresolvable one', () => {
    // Every included defect must resolve — one 'Common' (unmapped) blocks promotion.
    const data = {
      '_default:kitchen:sink': { tabs: { defects: [{ included: true, location: '101' }, { included: true, location: 'Common' }] } },
    };
    expect(Object.keys(rewriteKeysForPromotion(data, labelToUnitId))).toEqual(['_default:kitchen:sink']);
  });

  it('keeps _default when the entry has no included defects', () => {
    const data = { '_default:kitchen:sink': { tabs: { defects: [{ included: false, location: '101' }] } } };
    expect(Object.keys(rewriteKeysForPromotion(data, labelToUnitId))).toEqual(['_default:kitchen:sink']);
  });
});

describe('flattenUnitsToTagged', () => {
  it('demotes unit keys to _default + stamps location; idempotent; collects options', () => {
    const data = {
      'u1:kitchen:sink': { rating: 'd', tabs: { defects: [{ cannedId: 'c', included: true, location: '' }] } },
      '_default:roof:flash': { rating: 'g' },
    };
    const units = [{ id: 'u1', label: '101' }];
    const out = flattenUnitsToTagged(data, units);
    expect(Object.keys(out.data).sort()).toEqual(['_default:kitchen:sink', '_default:roof:flash']);
    expect((out.data['_default:kitchen:sink'] as { tabs: { defects: { location: string }[] } }).tabs.defects[0].location).toBe('101');
    expect(out.locationOptions).toEqual(['101']);
    // idempotent (no unit-prefixed keys remain)
    expect(flattenUnitsToTagged(out.data, units).data).toEqual(out.data);
  });

  it('MERGES two units colliding on the same section:item — no finding dropped', () => {
    const data = {
      'u1:kitchen:sink': { rating: 'd', tabs: { defects: [{ cannedId: 'leak', included: true }] } },
      'u2:kitchen:sink': { rating: 'm', tabs: { defects: [{ cannedId: 'rust', included: true }] } },
    };
    const units = [{ id: 'u1', label: '101' }, { id: 'u2', label: '102' }];
    const out = flattenUnitsToTagged(data, units);
    expect(Object.keys(out.data)).toEqual(['_default:kitchen:sink']);
    const merged = out.data['_default:kitchen:sink'] as { tabs: { defects: { cannedId: string; location?: string }[] } };
    // Both units' defects survive, each stamped with its own unit label.
    expect(merged.tabs.defects.map((d) => d.cannedId).sort()).toEqual(['leak', 'rust']);
    expect(merged.tabs.defects.find((d) => d.cannedId === 'leak')!.location).toBe('101');
    expect(merged.tabs.defects.find((d) => d.cannedId === 'rust')!.location).toBe('102');
  });

  it('merges a per-unit entry with an existing common (_default) entry on the same key', () => {
    const data = {
      '_default:kitchen:sink': { rating: 'g', tabs: { defects: [{ cannedId: 'common', included: true }] } },
      'u1:kitchen:sink': { rating: 'd', tabs: { defects: [{ cannedId: 'unit', included: true }] } },
    };
    const out = flattenUnitsToTagged(data, [{ id: 'u1', label: '101' }]);
    const merged = out.data['_default:kitchen:sink'] as { tabs: { defects: { cannedId: string }[] } };
    expect(merged.tabs.defects.map((d) => d.cannedId).sort()).toEqual(['common', 'unit']);
  });

  it('does NOT mutate the input data or its nested defects (pure)', () => {
    const data = {
      'u1:kitchen:sink': { rating: 'd', tabs: { defects: [{ cannedId: 'c', included: true, location: '' }] } },
    };
    const snapshot = JSON.parse(JSON.stringify(data));
    flattenUnitsToTagged(data, [{ id: 'u1', label: '101' }]);
    expect(data).toEqual(snapshot); // location on the original defect is still ''
  });

  it('passes through a foreign-unit key (unit not in the switch set) untouched', () => {
    const data = { 'ghost:roof:flash': { rating: 'd' } };
    const out = flattenUnitsToTagged(data, [{ id: 'u1', label: '101' }]);
    expect(out.data).toEqual({ 'ghost:roof:flash': { rating: 'd' } });
    expect(out.locationOptions).toEqual([]);
  });
});
