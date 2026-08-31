import { describe, it, expect } from 'vitest';
import {
    MAX_ITEM_DEPTH, itemDepths, subtreeOf, hasCycle, normalizeItemOrder,
    moveSubtreeAmongSiblings, reorderSubtree, deleteSubtree, duplicateSubtree,
    remapParentIds, outlineNumbers,
} from '../../../server/lib/template-hierarchy';

/** A three-level shape, as a template would carry it. */
const nested = [
    { id: 'a',   parentId: null },
    { id: 'a1',  parentId: 'a' },
    { id: 'a1x', parentId: 'a1' },
    { id: 'a2',  parentId: 'a' },
    { id: 'b',   parentId: null },
];

describe('itemDepths', () => {
    it('reads the depth of every item, and a flat list is all zeroes', () => {
        // The positive control for every "it refuses" test below: a template
        // that predates the field must come back as an all-top-level list,
        // which is what keeps every stored document rendering unchanged.
        const flat = [{ id: 'x' }, { id: 'y' }, { id: 'z' }];
        expect([...itemDepths(flat).values()]).toEqual([0, 0, 0]);
        expect(itemDepths(nested)).toEqual(new Map([
            ['a', 0], ['a1', 1], ['a1x', 2], ['a2', 1], ['b', 0],
        ]));
    });

    it('treats a parent that is not in the list as no parent at all', () => {
        // Dangling pointers arrive from duplicateSection, from platform-written
        // rows and from documents written before some fix. Fail OPEN to flat:
        // never crash, never drop the item, never render it under another
        // section. This is the only rule every reader shares.
        const dangling = [{ id: 'a', parentId: 'gone' }, { id: 'b', parentId: 'a' }];
        expect(itemDepths(dangling)).toEqual(new Map([['a', 0], ['b', 1]]));
    });

    it('does not hang on a cycle -- it reports the whole cycle as top level', () => {
        // itemDepths is the single entry point every reader uses, so the cycle
        // guard has to live HERE rather than in each of the flat walks.
        const cyclic = [{ id: 'a', parentId: 'b' }, { id: 'b', parentId: 'a' }];
        expect(itemDepths(cyclic)).toEqual(new Map([['a', 0], ['b', 0]]));
    });

    it('an empty list is an empty map, not a throw', () => {
        expect(itemDepths([])).toEqual(new Map());
    });
});

describe('hasCycle', () => {
    it('finds a cycle', () => {
        expect(hasCycle([{ id: 'a', parentId: 'b' }, { id: 'b', parentId: 'a' }])).toBe(true);
        expect(hasCycle([{ id: 'a', parentId: 'a' }])).toBe(true);
    });
    it('does NOT call an ordinary tree a cycle', () => {
        // The positive control. A checker that answered `true` for everything
        // would pass the two assertions above on its own.
        expect(hasCycle(nested)).toBe(false);
        expect(hasCycle([{ id: 'a' }, { id: 'b' }])).toBe(false);
    });
});

describe('subtreeOf', () => {
    it('returns the item and every descendant, in pre-order', () => {
        expect(subtreeOf(nested, 'a')).toEqual(['a', 'a1', 'a1x', 'a2']);
        expect(subtreeOf(nested, 'a1')).toEqual(['a1', 'a1x']);
    });
    it('a leaf is its own whole subtree', () => {
        expect(subtreeOf(nested, 'b')).toEqual(['b']);
    });
});

describe('normalizeItemOrder', () => {
    it('reorders a scrambled document into pre-order without losing an item', () => {
        // A hand-written or imported document may not be in pre-order. Fixing
        // it ONCE here is what lets every other flat walk stay a flat walk.
        //
        // Siblings keep their relative ARRAY order, which is the only ordering
        // information a scrambled document carries: `a2` sits ahead of `a1` in
        // the input, so it stays ahead of it under `a`. Inventing any other
        // sibling order here would be this module deciding something the
        // author never said.
        const scrambled = [
            { id: 'b',   parentId: null },
            { id: 'a1x', parentId: 'a1' },
            { id: 'a',   parentId: null },
            { id: 'a2',  parentId: 'a' },
            { id: 'a1',  parentId: 'a' },
        ];
        expect(normalizeItemOrder(scrambled).map(i => i.id))
            .toEqual(['b', 'a', 'a2', 'a1', 'a1x']);
    });
    it('leaves an already-correct list byte-identical', () => {
        const same = normalizeItemOrder(nested);
        expect(same.map(i => i.id)).toEqual(nested.map(i => i.id));
    });
    it('never loses an item, even one trapped in a cycle', () => {
        // Positive control for the reordering above: a pre-order walk cannot
        // reach a cycle member, and dropping it would be data loss disguised
        // as normalisation.
        const withCycle = [
            { id: 'a', parentId: null },
            { id: 'p', parentId: 'q' },
            { id: 'q', parentId: 'p' },
        ];
        expect(normalizeItemOrder(withCycle).map(i => i.id).sort())
            .toEqual(['a', 'p', 'q']);
    });
});

describe('moveSubtreeAmongSiblings', () => {
    it('moves a parent past its next sibling and takes its children along', () => {
        // The old moveItem was an adjacent SWAP. On a tree that is simply
        // wrong: swapping `a` with `a1` puts a parent underneath its own child.
        const moved = moveSubtreeAmongSiblings(nested, 'a', 1);
        expect(moved.map(i => i.id)).toEqual(['b', 'a', 'a1', 'a1x', 'a2']);
    });
    it('moves a child among its own siblings only', () => {
        // Positive control: an implementation that refused every move would
        // pass the edge assertion below.
        expect(moveSubtreeAmongSiblings(nested, 'a2', -1).map(i => i.id))
            .toEqual(['a', 'a2', 'a1', 'a1x', 'b']);
    });
    it('is a no-op at the edge of its OWN sibling run, not of the array', () => {
        // `a2` is the last child of `a`, but not the last row in the section.
        // Moving it down must do nothing rather than escape into `b`'s level.
        expect(moveSubtreeAmongSiblings(nested, 'a2', 1).map(i => i.id))
            .toEqual(nested.map(i => i.id));
    });
});

describe('reorderSubtree', () => {
    it('drops a subtree at another sibling position', () => {
        expect(reorderSubtree(nested, 'a1', 'a2').map(i => i.id))
            .toEqual(['a', 'a2', 'a1', 'a1x', 'b']);
    });
    it('REFUSES to drop an item inside its own subtree', () => {
        // The only gesture that can mint a cycle. Refusing returns the input.
        expect(reorderSubtree(nested, 'a', 'a1x').map(i => i.id))
            .toEqual(nested.map(i => i.id));
    });
    it('still allows an ordinary drop between unrelated items', () => {
        // Positive control for the refusal above.
        expect(reorderSubtree(nested, 'b', 'a').map(i => i.id))
            .toEqual(['b', 'a', 'a1', 'a1x', 'a2']);
    });
});

describe('deleteSubtree', () => {
    it('takes the whole subtree, never orphans a child', () => {
        // Promoting the children instead was considered and rejected: a
        // qualifier without the thing it qualifies is a sentence with no
        // subject, and it looks like a perfectly ordinary item.
        expect(deleteSubtree(nested, 'a').map(i => i.id)).toEqual(['b']);
    });
    it('deleting a leaf removes exactly one item', () => {
        expect(deleteSubtree(nested, 'a1x').map(i => i.id))
            .toEqual(['a', 'a1', 'a2', 'b']);
    });
});

describe('duplicateSubtree', () => {
    it('clones the descendants too and re-points their parentId at the clones', () => {
        let n = 0;
        const out = duplicateSubtree(nested, 'a', () => `new${++n}`);
        const ids = out.map(i => i.id);
        expect(ids).toEqual(['a', 'a1', 'a1x', 'a2', 'new1', 'new2', 'new3', 'new4', 'b']);
        const byId = new Map(out.map(i => [i.id, i]));
        // The copy's child points at the COPY, not at the original's child.
        expect(byId.get('new2')?.parentId).toBe('new1');
        expect(byId.get('new3')?.parentId).toBe('new2');
        expect(byId.get('new1')?.parentId).toBe(null);
    });
    it('leaves the original subtree pointing at itself', () => {
        // Positive control: a clone that re-pointed the ORIGINALS at the copies
        // would satisfy the assertions above and destroy the source.
        let n = 0;
        const out = duplicateSubtree(nested, 'a', () => `new${++n}`);
        const byId = new Map(out.map(i => [i.id, i]));
        expect(byId.get('a1')?.parentId).toBe('a');
        expect(byId.get('a1x')?.parentId).toBe('a1');
    });
});

describe('remapParentIds', () => {
    it('rewrites parent pointers through an id map', () => {
        // duplicateSection's fix: it already mints new ids, and without this
        // the clones keep pointing at the ORIGINAL section's items.
        const out = remapParentIds(nested, new Map([['a', 'A'], ['a1', 'A1']]));
        expect(out.find(i => i.id === 'a1')?.parentId).toBe('A');
        expect(out.find(i => i.id === 'a1x')?.parentId).toBe('A1');
    });
    it('drops a pointer the map does not cover rather than keeping a stale one', () => {
        // A pointer that survives a clone is worse than no pointer: it is a
        // cross-section parent, which no reader can resolve.
        const out = remapParentIds([{ id: 'x', parentId: 'elsewhere' }], new Map());
        expect(out[0].parentId).toBe(null);
    });
});

describe('outlineNumbers', () => {
    it('numbers the tree the way a printed form does', () => {
        expect(outlineNumbers(nested)).toEqual(new Map([
            ['a', 'A'], ['a1', 'A.1'], ['a1x', 'A.1.a'], ['a2', 'A.2'], ['b', 'B'],
        ]));
    });
    it('keeps numbering past Z at the top level', () => {
        const many = Array.from({ length: 27 }, (_, i) => ({ id: `i${i}` }));
        expect(outlineNumbers(many).get('i26')).toBe('AA');
    });
});

describe('MAX_ITEM_DEPTH', () => {
    it('is 3 levels -- the same bound, for the same reason, as the unit tree', () => {
        // server/services/unit.service.ts MAX_DEPTH = 3, "so a recursive parent
        // walk for depth + cycle detection stays bounded". Same shape, same
        // argument; a second bound would be a second philosophy.
        expect(MAX_ITEM_DEPTH).toBe(3);
    });
});
