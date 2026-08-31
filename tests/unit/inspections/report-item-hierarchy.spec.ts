/**
 * The report projection is the seventh place that decides what an item is, and
 * the one that fails most quietly: a key it does not read is simply not printed.
 *
 * ⚠️ THIS SPEC IS CHECKED BY tsc, NOT BY VITEST. Both assertions below are
 * about a TYPE, and vitest strips types with esbuild — run under vitest alone
 * it passes against a module that does not exist. `npm run type-check:tests`
 * is the run that can fail it, and it is the one that proved it red before
 * `report-schema-types.ts` was written.
 */
import { describe, it, expect } from 'vitest';
import type { SchemaItem } from '../../../server/services/inspection/report-schema-types';

describe('SchemaItem', () => {
    it('carries parentId through to the report data model', () => {
        const item: SchemaItem = { id: 'a1', label: 'Fully adhered', parentId: 'a' };
        expect(item.parentId).toBe('a');
    });
    it('accepts an item with no parentId at all', () => {
        // Every snapshot frozen before the field existed. If this stops
        // compiling the field became required and old reports stop rendering.
        const item: SchemaItem = { id: 'a', label: 'Sealed Roof Deck' };
        expect(item.parentId).toBeUndefined();
    });
});
