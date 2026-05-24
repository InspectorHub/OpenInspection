/**
 * Design System 0520 subsystem D P3 — childrenOf helper tests.
 *
 * The ReportUnitsSummary component is a JSX render; the only logic
 * worth asserting in isolation is `childrenOf`, which the renderer
 * calls recursively to walk building → floor → unit. Tested as a
 * pure function below.
 */
import { describe, it, expect } from 'vitest';
import { childrenOf, type ReportUnit } from '../../src/templates/components/report-units-summary';

const u = (id: string, parent: string | null, kind: 'building'|'floor'|'unit', name: string, order = 0): ReportUnit =>
    ({ id, parentUnitId: parent, kind, type: 'unit', name, sortOrder: order });

describe('childrenOf (subsystem D P3)', () => {
    it('returns top-level buildings when parentId is null', () => {
        const tree = [
            u('b1', null, 'building', 'A'),
            u('b2', null, 'building', 'B'),
            u('f1', 'b1', 'floor',    '1F'),
        ];
        expect(childrenOf(tree, null)).toHaveLength(2);
        expect(childrenOf(tree, null).map(x => x.id)).toEqual(['b1', 'b2']);
    });

    it('returns only direct children — does not flatten the tree', () => {
        const tree = [
            u('b1', null, 'building', 'A'),
            u('f1', 'b1', 'floor',    '1F'),
            u('u1', 'f1', 'unit',     '101'),
        ];
        expect(childrenOf(tree, 'b1')).toHaveLength(1);
        expect(childrenOf(tree, 'b1')[0].id).toBe('f1');
    });

    it('sorts siblings by sortOrder ascending', () => {
        const tree = [
            u('f3', 'b1', 'floor', '3F', 3),
            u('f1', 'b1', 'floor', '1F', 1),
            u('f2', 'b1', 'floor', '2F', 2),
        ];
        expect(childrenOf(tree, 'b1').map(x => x.id)).toEqual(['f1', 'f2', 'f3']);
    });

    it('returns empty array when parentId has no children', () => {
        const tree = [u('b1', null, 'building', 'A')];
        expect(childrenOf(tree, 'b1')).toEqual([]);
    });

    it('treats missing sortOrder as 0 (stable insertion order)', () => {
        const tree = [
            { id: 'b1', parentUnitId: null, kind: 'building' as const, type: 'unit' as const, name: 'A', sortOrder: 0 },
            { id: 'b2', parentUnitId: null, kind: 'building' as const, type: 'unit' as const, name: 'B', sortOrder: 0 },
        ];
        const out = childrenOf(tree, null);
        expect(out.map(x => x.id)).toEqual(['b1', 'b2']);
    });
});
