/**
 * Pure structural-edit snapshot operations for inspection template editing (D8).
 *
 * All functions are pure: they never mutate their inputs, always return a new
 * Snapshot, and every mutator passes its result through stripRuntimeKeys so the
 * output is persist-ready (matches the strict Zod template schema).
 *
 * NO React, NO DB imports — this module may run in any JS environment.
 */

import type {
    ItemType,
    ItemTabs,
    ItemOptions,
    CannedInfoComment,
    CannedDefect,
} from '../.././../server/types/template-schema';
import {
    subtreeOf, deleteSubtree, duplicateSubtree, moveSubtreeAmongSiblings,
    reorderSubtree, remapParentIds,
} from '../../../server/lib/template-hierarchy';

export type { ItemType };

// ---------------------------------------------------------------------------
// Loose structural types (mirrors TemplateSchemaV2 but with index signatures
// so the compiler accepts the in-memory objects that carry runtime keys)
// ---------------------------------------------------------------------------

export type Snapshot = { schemaVersion: 2; sections: Section[]; ratingSystem?: unknown; [k: string]: unknown };
type Section  = { id: string; title: string; items: Item[]; [k: string]: unknown };
// `parentId` is named rather than left to the index signature: the index
// signature types it `unknown`, and the tree ops need `string | null | undefined`
// to accept an Item at all.
export type Item     = { id: string; label: string; type: ItemType; parentId?: string | null; [k: string]: unknown };

// ---------------------------------------------------------------------------
// Allowlists (mirrored from template-schema.ts TemplateSection / TemplateItem)
// ---------------------------------------------------------------------------

/** Keys allowed on a TemplateSection (schema-defined, non-runtime). */
const SECTION_KEYS = new Set<string>([
    'id',
    'title',
    'icon',
    'identifier',
    'items',
    'disclaimerText',
    'alwaysPageBreak',
    'source',
    'defaultScope',
    'applicableTo',
    'sharedComments',
]);

/** Keys allowed on a TemplateItem (schema-defined, non-runtime). */
const ITEM_KEYS = new Set<string>([
    'id',
    'label',
    'type',
    'description',
    'ratingOptions',
    'tabs',
    'options',
    'icon',
    'number',
    'required',
    'isSafety',
    'defaultRecommendation',
    // No defaultEstimateMin / defaultEstimateMax — the template write schema
    // rejects them. Keeping them here would have the editor faithfully re-send
    // a price it found in an older stored template and get a 400 for it.
    'attributes',
    'source',
    // Nesting. Absent here would mean stripRuntimeKeys quietly flattens every
    // structural edit made inside an inspection -- the author's tree would
    // survive the template editor and evaporate the first time somebody added
    // an item on site.
    'parentId',
]);

// ---------------------------------------------------------------------------
// newId
// ---------------------------------------------------------------------------

/** Returns a stable, prefixed UUID string. */
export function newId(prefix: 'sec' | 'item'): string {
    return `${prefix}_${crypto.randomUUID()}`;
}

// ---------------------------------------------------------------------------
// buildNewItem
// ---------------------------------------------------------------------------

/**
 * Returns a minimal valid item for the given type.
 *
 * - `rich` → includes `ratingOptions: []` + empty `tabs` (three buckets).
 * - `select` / `multi_select` → includes `options: { choices: [] }`.
 * - all others → just `{ id, label, type }`.
 */
export function buildNewItem(label: string, type: ItemType): Item {
    const id = newId('item');

    if (type === 'rich') {
        const tabs: ItemTabs = {
            information: [] as CannedInfoComment[],
            limitations: [] as CannedInfoComment[],
            defects: [] as CannedDefect[],
        };
        return { id, label, type, ratingOptions: [] as string[], tabs } satisfies Item;
    }

    if (type === 'select' || type === 'multi_select') {
        const options: ItemOptions = { choices: [] };
        return { id, label, type, options } satisfies Item;
    }

    // boolean, text, textarea, number, date, photo_only — minimal
    return { id, label, type } satisfies Item;
}

// ---------------------------------------------------------------------------
// stripRuntimeKeys
// ---------------------------------------------------------------------------

/**
 * Deep-clones the snapshot, keeping ONLY schema-defined keys on sections and
 * items. Drops runtime fields such as `rating`, `notes`, `photos`,
 * `_progress`, `ratingColor`, `defectCount`, `severityBucket`,
 * `resolvedTabs`, etc.
 *
 * The output satisfies the strict Zod template schema and can be persisted
 * directly.
 */
export function stripRuntimeKeys(snapshot: Snapshot): Snapshot {
    const clone = structuredClone(snapshot) as Snapshot;

    clone.sections = clone.sections.map((rawSec) => {
        const sec: Record<string, unknown> = {};
        for (const key of SECTION_KEYS) {
            if (key in rawSec) {
                if (key === 'items') {
                    // Items handled below
                    continue;
                }
                sec[key] = (rawSec as Record<string, unknown>)[key];
            }
        }
        // Strip items too
        sec['items'] = rawSec.items.map((rawItem) => {
            const item: Record<string, unknown> = {};
            for (const k of ITEM_KEYS) {
                if (k in rawItem) {
                    item[k] = (rawItem as Record<string, unknown>)[k];
                }
            }
            return item as Item;
        });
        return sec as unknown as Section;
    });

    return clone;
}

// ---------------------------------------------------------------------------
// Section mutators
// ---------------------------------------------------------------------------

/** Appends a new empty section. */
export function addSection(snapshot: Snapshot, title: string): Snapshot {
    const newSec: Section = { id: newId('sec'), title, items: [] };
    const result: Snapshot = {
        ...snapshot,
        sections: [...snapshot.sections, newSec],
    };
    return stripRuntimeKeys(result);
}

/**
 * Clones a section + its items with fresh ids, inserts the clone right after
 * the source section. Structure only — no runtime/findings data.
 */
export function duplicateSection(snapshot: Snapshot, sectionId: string): Snapshot {
    const idx = snapshot.sections.findIndex(s => s.id === sectionId);
    if (idx === -1) {
        return stripRuntimeKeys({ ...snapshot, sections: [...snapshot.sections] });
    }
    const source = snapshot.sections[idx];
    // Fresh ids for every item, THEN re-point every parent pointer at the new
    // ids. Spreading the source item carried its old parentId into the new
    // section, where that id does not exist -- a pointer readers fail open on,
    // so the copy looked flat while the original looked nested. Nothing threw.
    const idMap = new Map(source.items.map((item) => [item.id, newId('item')]));
    const renamed = source.items.map((item) => ({
        ...(item as Record<string, unknown>),
        id: idMap.get(item.id) as string,
    } as Item));
    const clonedItems: Item[] = remapParentIds(renamed, idMap);
    const cloned: Section = {
        ...(source as Record<string, unknown>),
        id: newId('sec'),
        items: clonedItems,
    } as Section;

    const sections = [
        ...snapshot.sections.slice(0, idx + 1),
        cloned,
        ...snapshot.sections.slice(idx + 1),
    ];
    return stripRuntimeKeys({ ...snapshot, sections });
}

/** Removes the section with the given id. No-op if not found. */
export function deleteSection(snapshot: Snapshot, sectionId: string): Snapshot {
    const sections = snapshot.sections.filter(s => s.id !== sectionId);
    return stripRuntimeKeys({ ...snapshot, sections });
}

/**
 * Swaps the section with its neighbor in direction `dir` (+1 = down, -1 = up).
 * Clamped at edges (no-op past first/last).
 */
export function moveSection(snapshot: Snapshot, sectionId: string, dir: -1 | 1): Snapshot {
    const idx = snapshot.sections.findIndex(s => s.id === sectionId);
    if (idx === -1) {
        return stripRuntimeKeys({ ...snapshot, sections: [...snapshot.sections] });
    }
    const targetIdx = idx + dir;
    if (targetIdx < 0 || targetIdx >= snapshot.sections.length) {
        return stripRuntimeKeys({ ...snapshot, sections: [...snapshot.sections] });
    }
    const sections = [...snapshot.sections];
    [sections[idx], sections[targetIdx]] = [sections[targetIdx], sections[idx]];
    return stripRuntimeKeys({ ...snapshot, sections });
}

/**
 * Moves the section `fromId` to the position currently held by `toId`
 * (remove-then-insert-before-target — a single move-to-index, NOT a swap).
 * No-op if either id is missing or they are equal.
 */
export function reorderSection(snapshot: Snapshot, fromId: string, toId: string): Snapshot {
    const from = snapshot.sections.findIndex(s => s.id === fromId);
    const to = snapshot.sections.findIndex(s => s.id === toId);
    if (from === -1 || to === -1 || from === to) {
        return stripRuntimeKeys({ ...snapshot, sections: [...snapshot.sections] });
    }
    const sections = [...snapshot.sections];
    const [moved] = sections.splice(from, 1);
    sections.splice(to, 0, moved);
    return stripRuntimeKeys({ ...snapshot, sections });
}

/** Rename a section's title (structure only; unchanged sections untouched). */
export function renameSection(snapshot: Snapshot, sectionId: string, title: string): Snapshot {
    const sections = snapshot.sections.map(s => (s.id === sectionId ? { ...s, title } : s));
    return stripRuntimeKeys({ ...snapshot, sections });
}

// ---------------------------------------------------------------------------
// Item mutators
// ---------------------------------------------------------------------------

/** Rewrites one section's items; every item mutator below is this plus a tree op. */
function mapItems(
    snapshot: Snapshot,
    sectionId: string,
    fn: (items: Item[]) => Item[],
): Snapshot {
    const sections = snapshot.sections.map(sec =>
        (sec.id !== sectionId ? sec : ({ ...sec, items: fn(sec.items) } as Section)));
    return stripRuntimeKeys({ ...snapshot, sections });
}

/**
 * Appends a new item at TOP level — the "+ Add item" control sits at the end
 * of the list, and the end of the list is the end of the top level.
 *
 * `seed` merges over the minimal item `buildNewItem` produces. The template
 * editor seeds a rich item with the five-level vocabulary its authors expect;
 * the builder deliberately produces the smallest valid item, and an empty
 * `ratingOptions` serializes as a single "Inspected".
 */
export function addItem(
    snapshot: Snapshot,
    sectionId: string,
    label: string,
    type: ItemType,
    seed: Partial<Item> = {},
): Snapshot {
    return mapItems(snapshot, sectionId, items =>
        [...items, { ...buildNewItem(label, type), ...seed, parentId: null }]);
}

/**
 * Appends a new item UNDER `parentItemId`, at the END of that item's subtree.
 *
 * The end, not straight after the parent: a subtree is contiguous and starts at
 * its root, and inserting at the front would put the new row ahead of its own
 * older siblings — breaking the pre-order invariant every flat walk rests on.
 */
export function addSubItem(
    snapshot: Snapshot,
    sectionId: string,
    parentItemId: string,
    label: string,
    type: ItemType,
    seed: Partial<Item> = {},
): Snapshot {
    return mapItems(snapshot, sectionId, items => {
        const block = subtreeOf(items, parentItemId);
        if (block.length === 0) return items;
        const at = items.findIndex(i => i.id === block[block.length - 1]);
        const fresh: Item = { ...buildNewItem(label, type), ...seed, parentId: parentItemId };
        return [...items.slice(0, at + 1), fresh, ...items.slice(at + 1)];
    });
}

/**
 * Clones the item AND its descendants with fresh ids, inserted right after the
 * source subtree.
 *
 * Cloning the root alone leaves a copy whose children are still attached to the
 * original — a shell that looks like a copy on screen and is not one.
 */
export function duplicateItem(
    snapshot: Snapshot,
    sectionId: string,
    itemId: string,
): Snapshot {
    return mapItems(snapshot, sectionId, items =>
        duplicateSubtree(items, itemId, () => newId('item')));
}

/**
 * Removes the item AND everything under it. No-op if not found.
 *
 * Promoting the children instead was considered and rejected: a qualifier that
 * loses the thing it qualifies is a sentence with no subject, and it looks like
 * a perfectly ordinary item.
 */
export function deleteItem(
    snapshot: Snapshot,
    sectionId: string,
    itemId: string,
): Snapshot {
    return mapItems(snapshot, sectionId, items => deleteSubtree(items, itemId));
}

/**
 * Moves the item one place up/down AMONG ITS OWN SIBLINGS, subtree included.
 *
 * Not an adjacent array swap any more. Swapping an item with the row below it
 * put a parent underneath its own first child, which breaks the pre-order
 * invariant the whole flat-array design rests on. The edge is the end of the
 * item's own sibling run, not the end of the array.
 */
export function moveItem(
    snapshot: Snapshot,
    sectionId: string,
    itemId: string,
    dir: -1 | 1,
): Snapshot {
    return mapItems(snapshot, sectionId, items =>
        moveSubtreeAmongSiblings(items, itemId, dir));
}

/**
 * Drag-drop reorder: `fromId`'s subtree lands at `toId`'s position.
 *
 * Refuses a drop inside the dragged item's own subtree — the one gesture that
 * can mint a cycle.
 */
export function reorderItem(
    snapshot: Snapshot,
    sectionId: string,
    fromId: string,
    toId: string,
): Snapshot {
    return mapItems(snapshot, sectionId, items => reorderSubtree(items, fromId, toId));
}

/** Rename an item's label (structure only). */
export function renameItem(
    snapshot: Snapshot,
    sectionId: string,
    itemId: string,
    label: string,
): Snapshot {
    const sections = snapshot.sections.map(sec => {
        if (sec.id !== sectionId) return sec;
        return { ...sec, items: sec.items.map(it => (it.id === itemId ? { ...it, label } : it)) } as Section;
    });
    return stripRuntimeKeys({ ...snapshot, sections });
}
