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
    ItemAttribute,
    ItemSource,
    SectionApplicability,
    CannedInfoComment,
    CannedDefect,
} from '../.././../server/types/template-schema';

export type { ItemType };

// ---------------------------------------------------------------------------
// Loose structural types (mirrors TemplateSchemaV2 but with index signatures
// so the compiler accepts the in-memory objects that carry runtime keys)
// ---------------------------------------------------------------------------

export type Snapshot = { schemaVersion: 2; sections: Section[]; ratingSystem?: unknown; [k: string]: unknown };
export type Section  = { id: string; title: string; items: Item[]; [k: string]: unknown };
export type Item     = { id: string; label: string; type: ItemType; [k: string]: unknown };

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
    'defaultEstimateMin',
    'defaultEstimateMax',
    'attributes',
    'source',
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
    const clonedItems: Item[] = source.items.map((item) => ({
        ...(item as Record<string, unknown>),
        id: newId('item'),
    } as Item));
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

/** Appends a new item to the section. */
export function addItem(
    snapshot: Snapshot,
    sectionId: string,
    label: string,
    type: ItemType,
): Snapshot {
    const sections = snapshot.sections.map(sec => {
        if (sec.id !== sectionId) return sec;
        return {
            ...sec,
            items: [...sec.items, buildNewItem(label, type)],
        } as Section;
    });
    return stripRuntimeKeys({ ...snapshot, sections });
}

/**
 * Clones the item with a fresh id, inserts it right after the source item.
 * Runtime keys are stripped.
 */
export function duplicateItem(
    snapshot: Snapshot,
    sectionId: string,
    itemId: string,
): Snapshot {
    const sections = snapshot.sections.map(sec => {
        if (sec.id !== sectionId) return sec;
        const idx = sec.items.findIndex(i => i.id === itemId);
        if (idx === -1) return sec;
        const source = sec.items[idx];
        const cloned: Item = { ...(source as Record<string, unknown>), id: newId('item') } as Item;
        const items = [
            ...sec.items.slice(0, idx + 1),
            cloned,
            ...sec.items.slice(idx + 1),
        ];
        return { ...sec, items } as Section;
    });
    return stripRuntimeKeys({ ...snapshot, sections });
}

/** Removes the item from the section. No-op if not found. */
export function deleteItem(
    snapshot: Snapshot,
    sectionId: string,
    itemId: string,
): Snapshot {
    const sections = snapshot.sections.map(sec => {
        if (sec.id !== sectionId) return sec;
        return { ...sec, items: sec.items.filter(i => i.id !== itemId) } as Section;
    });
    return stripRuntimeKeys({ ...snapshot, sections });
}

/**
 * Swaps the item with its neighbor in direction `dir` (+1 = down, -1 = up).
 * Clamped at edges (no-op past first/last).
 */
export function moveItem(
    snapshot: Snapshot,
    sectionId: string,
    itemId: string,
    dir: -1 | 1,
): Snapshot {
    const sections = snapshot.sections.map(sec => {
        if (sec.id !== sectionId) return sec;
        const idx = sec.items.findIndex(i => i.id === itemId);
        if (idx === -1) return sec;
        const targetIdx = idx + dir;
        if (targetIdx < 0 || targetIdx >= sec.items.length) return sec;
        const items = [...sec.items];
        [items[idx], items[targetIdx]] = [items[targetIdx], items[idx]];
        return { ...sec, items } as Section;
    });
    return stripRuntimeKeys({ ...snapshot, sections });
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

// ---------------------------------------------------------------------------
// Re-export schema types consumers may need (avoids separate import)
// ---------------------------------------------------------------------------

export type {
    ItemTabs,
    ItemOptions,
    ItemAttribute,
    ItemSource,
    SectionApplicability,
};
