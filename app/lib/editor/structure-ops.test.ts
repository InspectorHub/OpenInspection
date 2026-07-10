import { describe, it, expect } from 'vitest';
import {
    newId,
    buildNewItem,
    stripRuntimeKeys,
    addSection,
    duplicateSection,
    deleteSection,
    moveSection,
    reorderSection,
    addItem,
    duplicateItem,
    deleteItem,
    moveItem,
} from '~/lib/editor/structure-ops';
import type { ItemType } from '~/lib/editor/structure-ops';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Build a minimal snapshot with 2 sections and some runtime-only keys. */
function makeFixture() {
    return {
        schemaVersion: 2 as const,
        sections: [
            {
                id: 'sec_1',
                title: 'Section One',
                items: [
                    {
                        id: 'item_1a',
                        label: 'Item 1A',
                        type: 'rich' as ItemType,
                        ratingOptions: ['Good', 'Fair', 'Poor'],
                        tabs: {
                            information: [],
                            limitations: [],
                            defects: [],
                        },
                        // RUNTIME keys — must be stripped
                        rating: 'Defect',
                        notes: 'inspector note',
                        _progress: 0.5,
                    },
                    {
                        id: 'item_1b',
                        label: 'Item 1B',
                        type: 'boolean' as ItemType,
                        rating: 'Good',
                    },
                ],
                // RUNTIME key on section
                _progress: 0.8,
            },
            {
                id: 'sec_2',
                title: 'Section Two',
                items: [
                    {
                        id: 'item_2a',
                        label: 'Item 2A',
                        type: 'text' as ItemType,
                        notes: 'some notes',
                    },
                ],
            },
        ],
    };
}

// ---------------------------------------------------------------------------
// newId
// ---------------------------------------------------------------------------

describe('newId', () => {
    it('produces a sec_-prefixed id', () => {
        expect(newId('sec')).toMatch(/^sec_[0-9a-f-]{36}$/);
    });
    it('produces an item_-prefixed id', () => {
        expect(newId('item')).toMatch(/^item_[0-9a-f-]{36}$/);
    });
    it('each call returns a unique id', () => {
        expect(newId('sec')).not.toBe(newId('sec'));
    });
});

// ---------------------------------------------------------------------------
// buildNewItem
// ---------------------------------------------------------------------------

describe('buildNewItem', () => {
    it('rich item has tabs and ratingOptions', () => {
        const item = buildNewItem('My Rich Item', 'rich');
        expect(item.type).toBe('rich');
        expect(item.label).toBe('My Rich Item');
        expect(item.id).toMatch(/^item_/);
        expect(Array.isArray(item.ratingOptions)).toBe(true);
        expect(item.tabs).toBeDefined();
        expect(item.tabs).toHaveProperty('information');
        expect(item.tabs).toHaveProperty('limitations');
        expect(item.tabs).toHaveProperty('defects');
    });

    it('select item has options array', () => {
        const item = buildNewItem('Choose One', 'select');
        expect(item.type).toBe('select');
        // options is an ItemOptions with choices
        expect(item.options).toBeDefined();
        expect(Array.isArray((item.options as { choices?: unknown[] }).choices)).toBe(true);
    });

    it('multi_select item has options array', () => {
        const item = buildNewItem('Choose Many', 'multi_select');
        expect(item.options).toBeDefined();
        expect(Array.isArray((item.options as { choices?: unknown[] }).choices)).toBe(true);
    });

    it('text item is minimal (no tabs, no ratingOptions)', () => {
        const item = buildNewItem('Plain Text', 'text');
        expect(item.type).toBe('text');
        expect(item.tabs).toBeUndefined();
        expect(item.ratingOptions).toBeUndefined();
    });

    it('boolean item is minimal', () => {
        const item = buildNewItem('Yes/No', 'boolean');
        expect(item.type).toBe('boolean');
        expect(item.tabs).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// stripRuntimeKeys
// ---------------------------------------------------------------------------

describe('stripRuntimeKeys', () => {
    it('removes rating, notes, _progress from items', () => {
        const snapshot = makeFixture() as ReturnType<typeof makeFixture> & Record<string, unknown>;
        const stripped = stripRuntimeKeys(snapshot as Parameters<typeof stripRuntimeKeys>[0]);
        for (const sec of stripped.sections) {
            expect(sec).not.toHaveProperty('_progress');
            for (const item of sec.items) {
                expect(item).not.toHaveProperty('rating');
                expect(item).not.toHaveProperty('notes');
                expect(item).not.toHaveProperty('_progress');
            }
        }
    });

    it('keeps id, title, items on sections', () => {
        const stripped = stripRuntimeKeys(makeFixture() as Parameters<typeof stripRuntimeKeys>[0]);
        const sec = stripped.sections[0];
        expect(sec).toHaveProperty('id', 'sec_1');
        expect(sec).toHaveProperty('title', 'Section One');
        expect(sec).toHaveProperty('items');
    });

    it('keeps id, label, type on items', () => {
        const stripped = stripRuntimeKeys(makeFixture() as Parameters<typeof stripRuntimeKeys>[0]);
        const item = stripped.sections[0].items[0];
        expect(item).toHaveProperty('id', 'item_1a');
        expect(item).toHaveProperty('label', 'Item 1A');
        expect(item).toHaveProperty('type', 'rich');
    });

    it('keeps ratingOptions and tabs on rich items', () => {
        const stripped = stripRuntimeKeys(makeFixture() as Parameters<typeof stripRuntimeKeys>[0]);
        const richItem = stripped.sections[0].items[0];
        expect(richItem).toHaveProperty('ratingOptions');
        expect(richItem).toHaveProperty('tabs');
    });

    it('does not mutate the original snapshot', () => {
        const original = makeFixture() as Parameters<typeof stripRuntimeKeys>[0];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sec0 = (original as any).sections[0];
        stripRuntimeKeys(original);
        expect(sec0._progress).toBe(0.8);
        expect((sec0.items[0] as Record<string, unknown>).rating).toBe('Defect');
    });
});

// ---------------------------------------------------------------------------
// addSection
// ---------------------------------------------------------------------------

describe('addSection', () => {
    it('appends a new section with a sec_-prefixed id', () => {
        const snap = makeFixture();
        const result = addSection(snap as Parameters<typeof addSection>[0], 'New Section');
        expect(result.sections).toHaveLength(3);
        const last = result.sections[2];
        expect(last.title).toBe('New Section');
        expect(last.id).toMatch(/^sec_/);
        expect(last.items).toEqual([]);
    });

    it('does not mutate the input snapshot', () => {
        const snap = makeFixture();
        addSection(snap as Parameters<typeof addSection>[0], 'Extra');
        expect(snap.sections).toHaveLength(2);
    });

    it('strips runtime keys from the output', () => {
        const snap = makeFixture();
        const result = addSection(snap as Parameters<typeof addSection>[0], 'New');
        // Existing sections should be stripped
        for (const sec of result.sections) {
            expect(sec).not.toHaveProperty('_progress');
        }
    });
});

// ---------------------------------------------------------------------------
// duplicateSection
// ---------------------------------------------------------------------------

describe('duplicateSection', () => {
    it('inserts a cloned section right after the source', () => {
        const snap = makeFixture();
        const result = duplicateSection(snap as Parameters<typeof duplicateSection>[0], 'sec_1');
        expect(result.sections).toHaveLength(3);
        expect(result.sections[1].title).toBe('Section One');
        // The duplicate is NOT the original
        expect(result.sections[1].id).not.toBe('sec_1');
        expect(result.sections[1].id).toMatch(/^sec_/);
    });

    it('clones items with fresh ids', () => {
        const snap = makeFixture();
        const result = duplicateSection(snap as Parameters<typeof duplicateSection>[0], 'sec_1');
        const dup = result.sections[1];
        expect(dup.items).toHaveLength(2);
        expect(dup.items[0].id).not.toBe('item_1a');
        expect(dup.items[0].id).toMatch(/^item_/);
        expect(dup.items[0].label).toBe('Item 1A');
    });

    it('does not include runtime keys in duplicated items', () => {
        const snap = makeFixture();
        const result = duplicateSection(snap as Parameters<typeof duplicateSection>[0], 'sec_1');
        const dup = result.sections[1];
        expect(dup).not.toHaveProperty('_progress');
        for (const item of dup.items) {
            expect(item).not.toHaveProperty('rating');
            expect(item).not.toHaveProperty('notes');
        }
    });

    it('does not mutate input', () => {
        const snap = makeFixture();
        duplicateSection(snap as Parameters<typeof duplicateSection>[0], 'sec_1');
        expect(snap.sections).toHaveLength(2);
    });
});

// ---------------------------------------------------------------------------
// deleteSection
// ---------------------------------------------------------------------------

describe('deleteSection', () => {
    it('removes the target section', () => {
        const snap = makeFixture();
        const result = deleteSection(snap as Parameters<typeof deleteSection>[0], 'sec_1');
        expect(result.sections).toHaveLength(1);
        expect(result.sections[0].id).toBe('sec_2');
    });

    it('is a no-op for unknown id', () => {
        const snap = makeFixture();
        const result = deleteSection(snap as Parameters<typeof deleteSection>[0], 'sec_nope');
        expect(result.sections).toHaveLength(2);
    });

    it('does not mutate input', () => {
        const snap = makeFixture();
        deleteSection(snap as Parameters<typeof deleteSection>[0], 'sec_1');
        expect(snap.sections).toHaveLength(2);
    });
});

// ---------------------------------------------------------------------------
// moveSection
// ---------------------------------------------------------------------------

describe('moveSection', () => {
    it('moves section down (+1)', () => {
        const snap = makeFixture();
        const result = moveSection(snap as Parameters<typeof moveSection>[0], 'sec_1', 1);
        expect(result.sections[0].id).toBe('sec_2');
        expect(result.sections[1].id).toBe('sec_1');
    });

    it('moves section up (-1)', () => {
        const snap = makeFixture();
        const result = moveSection(snap as Parameters<typeof moveSection>[0], 'sec_2', -1);
        expect(result.sections[0].id).toBe('sec_2');
        expect(result.sections[1].id).toBe('sec_1');
    });

    it('is a no-op at the beginning edge (move up)', () => {
        const snap = makeFixture();
        const result = moveSection(snap as Parameters<typeof moveSection>[0], 'sec_1', -1);
        expect(result.sections[0].id).toBe('sec_1');
    });

    it('is a no-op at the end edge (move down)', () => {
        const snap = makeFixture();
        const result = moveSection(snap as Parameters<typeof moveSection>[0], 'sec_2', 1);
        expect(result.sections[1].id).toBe('sec_2');
    });

    it('does not mutate input', () => {
        const snap = makeFixture();
        moveSection(snap as Parameters<typeof moveSection>[0], 'sec_1', 1);
        expect(snap.sections[0].id).toBe('sec_1');
    });
});

// ---------------------------------------------------------------------------
// reorderSection
// ---------------------------------------------------------------------------

/** Build a minimal 3-section snapshot (a, b, c) for drag-reorder tests. */
function makeThreeSectionFixture() {
    return {
        schemaVersion: 2 as const,
        sections: [
            { id: 'a', title: 'Section A', items: [] },
            { id: 'b', title: 'Section B', items: [] },
            { id: 'c', title: 'Section C', items: [] },
        ],
    };
}

describe('reorderSection', () => {
    it('moves the first section onto the third, yielding order [b, c, a]', () => {
        const snap = makeThreeSectionFixture();
        const result = reorderSection(snap as Parameters<typeof reorderSection>[0], 'a', 'c');
        expect(result.sections.map(s => s.id)).toEqual(['b', 'c', 'a']);
    });

    it('is a no-op for an unknown fromId', () => {
        const snap = makeThreeSectionFixture();
        const result = reorderSection(snap as Parameters<typeof reorderSection>[0], 'nope', 'c');
        expect(result.sections.map(s => s.id)).toEqual(['a', 'b', 'c']);
    });

    it('is a no-op for an unknown toId', () => {
        const snap = makeThreeSectionFixture();
        const result = reorderSection(snap as Parameters<typeof reorderSection>[0], 'a', 'nope');
        expect(result.sections.map(s => s.id)).toEqual(['a', 'b', 'c']);
    });

    it('is a no-op when fromId === toId', () => {
        const snap = makeThreeSectionFixture();
        const result = reorderSection(snap as Parameters<typeof reorderSection>[0], 'b', 'b');
        expect(result.sections.map(s => s.id)).toEqual(['a', 'b', 'c']);
    });

    it('does not mutate input', () => {
        const snap = makeThreeSectionFixture();
        reorderSection(snap as Parameters<typeof reorderSection>[0], 'a', 'c');
        expect(snap.sections.map(s => s.id)).toEqual(['a', 'b', 'c']);
    });
});

// ---------------------------------------------------------------------------
// addItem
// ---------------------------------------------------------------------------

describe('addItem', () => {
    it('appends a rich item with tabs + ratingOptions', () => {
        const snap = makeFixture();
        const result = addItem(snap as Parameters<typeof addItem>[0], 'sec_1', 'New Rich', 'rich');
        const sec = result.sections.find(s => s.id === 'sec_1')!;
        expect(sec.items).toHaveLength(3);
        const newItem = sec.items[2];
        expect(newItem.label).toBe('New Rich');
        expect(newItem.type).toBe('rich');
        expect(newItem).toHaveProperty('tabs');
        expect(newItem).toHaveProperty('ratingOptions');
    });

    it('appends a select item with options', () => {
        const snap = makeFixture();
        const result = addItem(snap as Parameters<typeof addItem>[0], 'sec_1', 'Choose', 'select');
        const sec = result.sections.find(s => s.id === 'sec_1')!;
        const newItem = sec.items[2];
        expect(newItem.type).toBe('select');
        expect(newItem).toHaveProperty('options');
    });

    it('appends a text item (minimal)', () => {
        const snap = makeFixture();
        const result = addItem(snap as Parameters<typeof addItem>[0], 'sec_2', 'Plain', 'text');
        const sec = result.sections.find(s => s.id === 'sec_2')!;
        const newItem = sec.items[1];
        expect(newItem.type).toBe('text');
        expect(newItem.tabs).toBeUndefined();
        expect(newItem.ratingOptions).toBeUndefined();
    });

    it('does not mutate input', () => {
        const snap = makeFixture();
        addItem(snap as Parameters<typeof addItem>[0], 'sec_1', 'New', 'text');
        expect(snap.sections[0].items).toHaveLength(2);
    });
});

// ---------------------------------------------------------------------------
// duplicateItem
// ---------------------------------------------------------------------------

describe('duplicateItem', () => {
    it('inserts a copy right after the source item', () => {
        const snap = makeFixture();
        const result = duplicateItem(snap as Parameters<typeof duplicateItem>[0], 'sec_1', 'item_1a');
        const sec = result.sections.find(s => s.id === 'sec_1')!;
        expect(sec.items).toHaveLength(3);
        // The dup is at index 1
        const dup = sec.items[1];
        expect(dup.id).not.toBe('item_1a');
        expect(dup.id).toMatch(/^item_/);
        expect(dup.label).toBe('Item 1A');
        expect(dup.type).toBe('rich');
    });

    it('does not copy runtime keys (rating, notes)', () => {
        const snap = makeFixture();
        const result = duplicateItem(snap as Parameters<typeof duplicateItem>[0], 'sec_1', 'item_1a');
        const dup = result.sections[0].items[1];
        expect(dup).not.toHaveProperty('rating');
        expect(dup).not.toHaveProperty('notes');
        expect(dup).not.toHaveProperty('_progress');
    });

    it('does not mutate input', () => {
        const snap = makeFixture();
        duplicateItem(snap as Parameters<typeof duplicateItem>[0], 'sec_1', 'item_1a');
        expect(snap.sections[0].items).toHaveLength(2);
    });
});

// ---------------------------------------------------------------------------
// deleteItem
// ---------------------------------------------------------------------------

describe('deleteItem', () => {
    it('removes the target item', () => {
        const snap = makeFixture();
        const result = deleteItem(snap as Parameters<typeof deleteItem>[0], 'sec_1', 'item_1a');
        const sec = result.sections.find(s => s.id === 'sec_1')!;
        expect(sec.items).toHaveLength(1);
        expect(sec.items[0].id).toBe('item_1b');
    });

    it('is a no-op for unknown item id', () => {
        const snap = makeFixture();
        const result = deleteItem(snap as Parameters<typeof deleteItem>[0], 'sec_1', 'item_nope');
        expect(result.sections[0].items).toHaveLength(2);
    });

    it('does not mutate input', () => {
        const snap = makeFixture();
        deleteItem(snap as Parameters<typeof deleteItem>[0], 'sec_1', 'item_1a');
        expect(snap.sections[0].items).toHaveLength(2);
    });
});

// ---------------------------------------------------------------------------
// moveItem
// ---------------------------------------------------------------------------

describe('moveItem', () => {
    it('moves item down (+1)', () => {
        const snap = makeFixture();
        const result = moveItem(snap as Parameters<typeof moveItem>[0], 'sec_1', 'item_1a', 1);
        const sec = result.sections.find(s => s.id === 'sec_1')!;
        expect(sec.items[0].id).toBe('item_1b');
        expect(sec.items[1].id).toBe('item_1a');
    });

    it('moves item up (-1)', () => {
        const snap = makeFixture();
        const result = moveItem(snap as Parameters<typeof moveItem>[0], 'sec_1', 'item_1b', -1);
        const sec = result.sections.find(s => s.id === 'sec_1')!;
        expect(sec.items[0].id).toBe('item_1b');
        expect(sec.items[1].id).toBe('item_1a');
    });

    it('is a no-op at the beginning edge', () => {
        const snap = makeFixture();
        const result = moveItem(snap as Parameters<typeof moveItem>[0], 'sec_1', 'item_1a', -1);
        expect(result.sections[0].items[0].id).toBe('item_1a');
    });

    it('is a no-op at the end edge', () => {
        const snap = makeFixture();
        const result = moveItem(snap as Parameters<typeof moveItem>[0], 'sec_1', 'item_1b', 1);
        expect(result.sections[0].items[1].id).toBe('item_1b');
    });

    it('does not mutate input', () => {
        const snap = makeFixture();
        moveItem(snap as Parameters<typeof moveItem>[0], 'sec_1', 'item_1a', 1);
        expect(snap.sections[0].items[0].id).toBe('item_1a');
    });
});
