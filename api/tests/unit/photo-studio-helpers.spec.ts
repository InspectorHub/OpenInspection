import { describe, it, expect } from 'vitest';
import {
    addShape,
    undoLast,
    redoLast,
    resetShapes,
    serialize,
    deserialize,
} from '../../public/js/photo-studio-helpers.js';
import type { Shape, UndoState } from '../../public/js/photo-studio-helpers.js';

describe('PhotoStudio helpers', () => {
    it('addShape appends and clears redo stack', () => {
        const out = addShape({ shapes: [], redo: [] }, { type: 'circle', cx: 1, cy: 1, rx: 5, ry: 5 });
        expect(out.shapes).toHaveLength(1);
        expect(out.redo).toEqual([]);
    });

    it('addShape after undo clears redo', () => {
        const initial: UndoState = {
            shapes: [{ type: 'arrow' } as Shape],
            redo:   [{ type: 'circle' } as Shape],
        };
        const s = addShape(initial, { type: 'label', x: 1, y: 1, text: 'x' });
        expect(s.redo).toEqual([]);
    });

    it('undoLast moves last shape to redo', () => {
        const out = undoLast({ shapes: [{ type: 'arrow' }, { type: 'circle' }], redo: [] });
        expect(out.shapes).toEqual([{ type: 'arrow' }]);
        expect(out.redo).toEqual([{ type: 'circle' }]);
    });

    it('undoLast on empty is no-op', () => {
        const s = { shapes: [], redo: [] };
        expect(undoLast(s)).toEqual(s);
    });

    it('redoLast moves last redo back to shapes', () => {
        const out = redoLast({ shapes: [{ type: 'arrow' }], redo: [{ type: 'circle' }] });
        expect(out.shapes).toEqual([{ type: 'arrow' }, { type: 'circle' }]);
        expect(out.redo).toEqual([]);
    });

    it('redoLast on empty redo is no-op', () => {
        const s = { shapes: [{ type: 'arrow' as const }], redo: [] };
        expect(redoLast(s)).toEqual(s);
    });

    it('resetShapes empties both stacks', () => {
        expect(resetShapes({ shapes: [{ type: 'arrow' as const }, { type: 'circle' as const }], redo: [{ type: 'label' as const }] })).toEqual({ shapes: [], redo: [] });
    });

    it('serialize / deserialize roundtrip', () => {
        const shapes = [
            { type: 'circle' as const, cx: 10, cy: 20, rx: 5, ry: 5 },
            { type: 'label'  as const, x:  1, y: 2, text: 'leak' },
        ];
        expect(deserialize(serialize(shapes))).toEqual(shapes);
    });

    it('deserialize tolerates empty / null / malformed', () => {
        expect(deserialize('')).toEqual([]);
        expect(deserialize('null')).toEqual([]);
        expect(deserialize('not json')).toEqual([]);
        expect(deserialize(null)).toEqual([]);
        expect(deserialize(undefined)).toEqual([]);
    });

    it('deserialize extracts shapes from v1 envelope', () => {
        const json = JSON.stringify({ version: 1, shapes: [{ type: 'arrow' as const }] });
        expect(deserialize(json)).toEqual([{ type: 'arrow' }]);
    });
});
