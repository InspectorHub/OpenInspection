/**
 * Unit tests for flattenReportDefects — uniqueness of generated findingKeys.
 *
 * Verifies the per-defect keying strategy introduced to fix the bug where
 * multiple defects on the same (sectionId, itemId) collapsed to a single key.
 *
 * Key format: `{source}:{sectionId}:{itemId}:{recommendationId|'custom'}`
 * Collision ordinal `#N` is appended (from #1) when two entries share the same
 * base key (e.g. two custom defects with null slug on the same item).
 */

import { describe, it, expect } from 'vitest';
import { flattenReportDefects } from '../../../server/lib/repair-defects';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(
    sectionId: string,
    itemId: string,
    source: 'canned' | 'custom',
    recommendationId: string | null,
    overrides: Partial<{
        sectionTitle: string;
        itemLabel:    string;
        comment:      string;
        category:     'safety' | 'recommendation' | 'maintenance';
    }> = {},
) {
    return {
        sectionId,
        sectionTitle: overrides.sectionTitle ?? `Section ${sectionId}`,
        itemId,
        itemLabel:    overrides.itemLabel    ?? `Item ${itemId}`,
        comment:      overrides.comment      ?? '',
        category:     overrides.category     ?? ('maintenance' as const),
        source,
        recommendationId,
    };
}

function fakeSvc(defects: ReturnType<typeof makeEntry>[]) {
    return {
        getRepairList: async (_inspId: string, _tenantId: string) => ({ defects }),
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('flattenReportDefects — findingKey uniqueness', () => {

    it('produces distinct keys for canned + custom on the same item', async () => {
        // One canned (recommendationId 'r1') + one custom (null) on (s1, item1)
        const svc = fakeSvc([
            makeEntry('s1', 'item1', 'canned', 'r1'),
            makeEntry('s1', 'item1', 'custom', null),
        ]);

        const result = await flattenReportDefects(svc, 'insp1', 't1');

        expect(result).toHaveLength(2);
        const keys = result.map(d => d.findingKey);
        expect(keys[0]).toBe('canned:s1:item1:r1');
        expect(keys[1]).toBe('custom:s1:item1:custom');
        expect(new Set(keys).size).toBe(2);
    });

    it('appends collision ordinal for two custom defects with no slug on same item', async () => {
        // Two custom defects with null slug on (s2, item2)
        const svc = fakeSvc([
            makeEntry('s2', 'item2', 'custom', null),
            makeEntry('s2', 'item2', 'custom', null),
        ]);

        const result = await flattenReportDefects(svc, 'insp1', 't1');

        expect(result).toHaveLength(2);
        expect(result[0].findingKey).toBe('custom:s2:item2:custom');
        expect(result[1].findingKey).toBe('custom:s2:item2:custom#1');
    });

    it('all 4 keys are distinct across mixed collision scenarios', async () => {
        // (s1, item1) canned r1 + (s1, item1) custom null
        // (s2, item2) custom null (first) + (s2, item2) custom null (second)
        const svc = fakeSvc([
            makeEntry('s1', 'item1', 'canned', 'r1'),
            makeEntry('s1', 'item1', 'custom', null),
            makeEntry('s2', 'item2', 'custom', null),
            makeEntry('s2', 'item2', 'custom', null),
        ]);

        const result = await flattenReportDefects(svc, 'insp1', 't1');

        expect(result).toHaveLength(4);
        const keys = result.map(d => d.findingKey);
        expect(new Set(keys).size).toBe(4);

        expect(keys[0]).toBe('canned:s1:item1:r1');
        expect(keys[1]).toBe('custom:s1:item1:custom');
        expect(keys[2]).toBe('custom:s2:item2:custom');
        expect(keys[3]).toBe('custom:s2:item2:custom#1');
    });

    it('no collision ordinal for first occurrence — base key is used as-is', async () => {
        const svc = fakeSvc([
            makeEntry('s3', 'item3', 'canned', 'roof-damage'),
        ]);

        const result = await flattenReportDefects(svc, 'insp1', 't1');

        expect(result[0].findingKey).toBe('canned:s3:item3:roof-damage');
        expect(result[0].findingKey).not.toContain('#');
    });

    it('ordinal increments beyond 1 for three colliding custom entries', async () => {
        const svc = fakeSvc([
            makeEntry('s4', 'item4', 'custom', null),
            makeEntry('s4', 'item4', 'custom', null),
            makeEntry('s4', 'item4', 'custom', null),
        ]);

        const result = await flattenReportDefects(svc, 'insp1', 't1');

        expect(result).toHaveLength(3);
        expect(result[0].findingKey).toBe('custom:s4:item4:custom');
        expect(result[1].findingKey).toBe('custom:s4:item4:custom#1');
        expect(result[2].findingKey).toBe('custom:s4:item4:custom#2');
    });

    it('preserves all other RepairDefect fields unchanged', async () => {
        const entry = makeEntry('s5', 'item5', 'canned', 'electrical', {
            sectionTitle: 'Electrical',
            itemLabel:    'Panel',
            comment:      'Double-tapped breaker',
            category:     'safety',
        });
        const svc = fakeSvc([entry]);

        const [defect] = await flattenReportDefects(svc, 'insp1', 't1');

        expect(defect.sectionId).toBe('s5');
        expect(defect.sectionTitle).toBe('Electrical');
        expect(defect.itemId).toBe('item5');
        expect(defect.itemLabel).toBe('Panel');
        expect(defect.comment).toBe('Double-tapped breaker');
        expect(defect.category).toBe('safety');
    });
});
