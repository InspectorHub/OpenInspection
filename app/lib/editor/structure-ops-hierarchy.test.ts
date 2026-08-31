import { describe, it, expect } from 'vitest';
import {
    addItem, addSubItem, duplicateItem, deleteItem, moveItem, reorderItem,
    duplicateSection, stripRuntimeKeys,
} from './structure-ops';
import type { Snapshot } from './structure-ops';

const snap = (): Snapshot => ({
    schemaVersion: 2,
    sections: [{
        id: 'sec1', title: 'Roof',
        items: [
            { id: 'a',   label: 'Sealed Roof Deck', type: 'boolean', parentId: null },
            { id: 'a1',  label: 'Fully adhered',    type: 'boolean', parentId: 'a' },
            { id: 'a1x', label: 'entire underside', type: 'boolean', parentId: 'a1' },
            { id: 'b',   label: 'Roof covering',    type: 'boolean', parentId: null },
        ],
    }],
});
const ids = (s: Snapshot) => s.sections[0].items.map((i) => i.id);
const parents = (s: Snapshot) =>
    Object.fromEntries(s.sections[0].items.map((i) => [i.id, i.parentId ?? null]));

describe('stripRuntimeKeys', () => {
    it('KEEPS parentId', () => {
        // Without this, every structural edit made inside an inspection
        // silently flattens the author's tree -- and nothing throws.
        expect(parents(stripRuntimeKeys(snap()))).toEqual({
            a: null, a1: 'a', a1x: 'a1', b: null,
        });
    });
    it('still drops a runtime key beside it', () => {
        // Positive control: an allowlist that kept everything would pass the
        // assertion above without keeping anything on purpose.
        const dirty = snap();
        (dirty.sections[0].items[0] as Record<string, unknown>).rating = 'Defect';
        expect('rating' in stripRuntimeKeys(dirty).sections[0].items[0]).toBe(false);
    });
});

describe('deleteItem', () => {
    it('takes the subtree with the parent', () => {
        expect(ids(deleteItem(snap(), 'sec1', 'a'))).toEqual(['b']);
    });
    it('deleting a leaf removes exactly one', () => {
        expect(ids(deleteItem(snap(), 'sec1', 'a1x'))).toEqual(['a', 'a1', 'b']);
    });
});

describe('moveItem', () => {
    it('moves the whole subtree among siblings, never under its own child', () => {
        // The old implementation swapped adjacent array entries. On `a` that
        // put the parent below `a1` -- its own child.
        const out = moveItem(snap(), 'sec1', 'a', 1);
        expect(ids(out)).toEqual(['b', 'a', 'a1', 'a1x']);
        expect(parents(out).a1).toBe('a');
    });
    it('is a no-op at the edge of its own sibling run', () => {
        // `a1x` is the only child of `a1`. There are rows below it in the
        // section, and it must not escape into their level.
        expect(ids(moveItem(snap(), 'sec1', 'a1x', 1))).toEqual(ids(snap()));
    });
});

describe('reorderItem', () => {
    it('drags a subtree to another position, children in tow', () => {
        const out = reorderItem(snap(), 'sec1', 'a', 'b');
        expect(ids(out)).toEqual(['b', 'a', 'a1', 'a1x']);
    });
    it('REFUSES a drop inside the dragged item own subtree', () => {
        // The one gesture that can mint a cycle.
        expect(ids(reorderItem(snap(), 'sec1', 'a', 'a1x'))).toEqual(ids(snap()));
    });
});

describe('duplicateItem', () => {
    it('clones the descendants and re-points them at the clones', () => {
        const out = duplicateItem(snap(), 'sec1', 'a');
        expect(out.sections[0].items).toHaveLength(7);
        const list = out.sections[0].items;
        const cloneRoot = list[3];
        const cloneChild = list[4];
        expect(cloneChild.parentId).toBe(cloneRoot.id);
        expect(cloneRoot.parentId).toBe(null);
    });
    it('duplicating a leaf still produces exactly one new item', () => {
        expect(duplicateItem(snap(), 'sec1', 'a1x').sections[0].items).toHaveLength(5);
    });
});

describe('addItem', () => {
    it('appends at top level with no parent', () => {
        const out = addItem(snap(), 'sec1', 'New', 'boolean');
        const last = out.sections[0].items[4];
        expect(last.parentId ?? null).toBe(null);
    });
});

describe('addSubItem', () => {
    it('lands at the END of the parent subtree, keeping pre-order', () => {
        // Inserting straight after the parent would put the new row ahead of
        // its own older siblings and break the invariant every flat walk rests
        // on: a subtree is contiguous and starts at its root.
        const out = addSubItem(snap(), 'sec1', 'a', 'New', 'boolean');
        const list = out.sections[0].items;
        expect(list.map((i) => i.id).slice(0, 3)).toEqual(['a', 'a1', 'a1x']);
        expect(list[3].parentId).toBe('a');
        expect(list[4].id).toBe('b');
    });
    it('is a no-op for a parent that is not in the section', () => {
        expect(ids(addSubItem(snap(), 'sec1', 'nowhere', 'New', 'boolean')))
            .toEqual(ids(snap()));
    });
});

describe('duplicateSection', () => {
    it('re-points the clones parentId at the CLONED items', () => {
        // This is the one place where existing code becomes wrong the moment
        // parentId exists: `{...item, id: newId()}` carried the OLD parentId
        // into a new section, minting cross-section parents.
        const out = duplicateSection(snap(), 'sec1');
        const cloned = out.sections[1].items;
        const clonedIds = new Set(cloned.map((i) => i.id));
        const originalIds = new Set(snap().sections[0].items.map((i) => i.id));
        for (const item of cloned) {
            const p = item.parentId ?? null;
            if (p === null) continue;
            expect(clonedIds.has(p as string)).toBe(true);
            expect(originalIds.has(p as string)).toBe(false);
        }
        expect(cloned.filter((i) => (i.parentId ?? null) !== null)).toHaveLength(2);
    });
    it('leaves the source section untouched', () => {
        // Positive control: a "fix" that nulled every parentId everywhere would
        // pass the assertion above.
        const out = duplicateSection(snap(), 'sec1');
        expect(parents({ ...out, sections: [out.sections[0]] } as Snapshot)).toEqual({
            a: null, a1: 'a', a1x: 'a1', b: null,
        });
    });
});
