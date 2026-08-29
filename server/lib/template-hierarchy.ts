/**
 * The one place that knows a template's items form a tree.
 *
 * -- WHY THIS IS ONE MODULE -------------------------------------------------
 * Dozens of places walk `section.items`. If each of them worked out depth, or
 * defended itself against a dangling parent pointer, every one of them would
 * have to remember. They do not have to: every read goes through `itemDepths`,
 * and the dangling and cycle defences live inside it.
 *
 * -- WHY server/lib AND NOT app/lib -----------------------------------------
 * Both sides need it. `app/` already imports runtime values from `server/lib/`
 * (finding-key, statutory/revision-status, deployment-profile, ...), so a
 * second copy under app/ would be a copy with no reason -- unlike
 * app/lib/editor/statutory-groups.ts, which is a genuinely front-end concern.
 *
 * -- WHY THE INPUT TYPE IS STRUCTURAL ---------------------------------------
 * There are seven declarations of "what a template item is" in this repo. This
 * module names none of them: it asks for `{ id, parentId? }` and works with
 * all seven.
 *
 * NO React, NO DB, NO Node APIs.
 */

/** The deepest an item may sit: top level (0) plus two levels under it. */
export const MAX_ITEM_DEPTH = 3;

/** All this module needs of an item. */
export interface HierarchyNode {
    id: string;
    parentId?: string | null;
}

/** A parent id that actually resolves inside this list, or null. */
function resolvedParent<T extends HierarchyNode>(
    node: T, byId: ReadonlyMap<string, T>,
): string | null {
    const parentId = node.parentId ?? null;
    if (!parentId) return null;
    if (parentId === node.id) return null;           // self-parent: a one-node cycle
    return byId.has(parentId) ? parentId : null;     // dangling: treat as top level
}

/**
 * Depth of every item, 0 for top level.
 *
 * FAILS OPEN. A parent that is not in this list, a self-parent, or a cycle all
 * resolve to "top level" rather than to a throw. A crash here is a blank
 * report; a flat render is a truthful one.
 */
export function itemDepths<T extends HierarchyNode>(
    items: ReadonlyArray<T>,
): Map<string, number> {
    const byId = new Map(items.map((i) => [i.id, i]));
    const depth = new Map<string, number>();
    for (const item of items) {
        let steps = 0;
        let cursor: T | undefined = item;
        const seen = new Set<string>([item.id]);
        for (;;) {
            const parentId: string | null = cursor ? resolvedParent(cursor, byId) : null;
            if (parentId === null) break;
            if (seen.has(parentId)) { steps = 0; break; }   // cycle -> top level
            seen.add(parentId);
            steps += 1;
            if (steps >= MAX_ITEM_DEPTH) break;             // bounded walk, always
            cursor = byId.get(parentId);
        }
        depth.set(item.id, steps);
    }
    return depth;
}

/** True when following parent pointers ever revisits an id. */
export function hasCycle<T extends HierarchyNode>(items: ReadonlyArray<T>): boolean {
    const byId = new Map(items.map((i) => [i.id, i]));
    for (const item of items) {
        const seen = new Set<string>([item.id]);
        let cursor: T | undefined = item;
        while (cursor) {
            const parentId = cursor.parentId ?? null;
            if (!parentId) break;
            if (seen.has(parentId)) return true;
            if (!byId.has(parentId)) break;                 // dangling, not a cycle
            seen.add(parentId);
            cursor = byId.get(parentId);
        }
    }
    return false;
}

/** Direct children of `parentId` (null = top level), in array order. */
function childrenOf<T extends HierarchyNode>(
    items: ReadonlyArray<T>, parentId: string | null,
): T[] {
    const byId = new Map(items.map((i) => [i.id, i]));
    return items.filter((i) => resolvedParent(i, byId) === parentId);
}

/** `id` followed by every descendant, in pre-order. */
export function subtreeOf<T extends HierarchyNode>(
    items: ReadonlyArray<T>, id: string,
): string[] {
    const out: string[] = [];
    const visit = (nodeId: string, guard: number) => {
        out.push(nodeId);
        if (guard >= MAX_ITEM_DEPTH) return;
        for (const child of childrenOf(items, nodeId)) visit(child.id, guard + 1);
    };
    if (items.some((i) => i.id === id)) visit(id, 0);
    return out;
}

/**
 * Re-lay the array so it is a pre-order walk of the tree.
 *
 * This is what lets every other walk in the codebase stay a flat `.map`: read
 * in array order and a report prints A, A.1, A.1.a, A.2, B by itself.
 *
 * Siblings keep their relative ARRAY order, because that is the only ordering
 * information a scrambled document carries.
 */
export function normalizeItemOrder<T extends HierarchyNode>(items: ReadonlyArray<T>): T[] {
    const out: T[] = [];
    const emit = (parentId: string | null, guard: number) => {
        for (const child of childrenOf(items, parentId)) {
            out.push(child);
            if (guard + 1 < MAX_ITEM_DEPTH) emit(child.id, guard + 1);
        }
    };
    emit(null, 0);
    // Anything unreached (a cycle member) is appended so nothing is ever lost.
    for (const item of items) if (!out.includes(item)) out.push(item);
    return out;
}

/** Splice one contiguous subtree out and back in at `insertBefore` (or the end). */
function spliceSubtree<T extends HierarchyNode>(
    items: ReadonlyArray<T>, subtreeIds: ReadonlyArray<string>, insertBefore: string | null,
): T[] {
    const moving = new Set(subtreeIds);
    const block = items.filter((i) => moving.has(i.id));
    const rest = items.filter((i) => !moving.has(i.id));
    const at = insertBefore === null ? rest.length : rest.findIndex((i) => i.id === insertBefore);
    const index = at < 0 ? rest.length : at;
    return [...rest.slice(0, index), ...block, ...rest.slice(index)];
}

/**
 * Drag-drop: move `fromId`'s subtree to `toId`'s position. Refuses self-nesting.
 *
 * Direction decides which side of the target the block lands on, which is what
 * makes a drag feel like a move rather than a no-op: dragging DOWN onto a row
 * puts the block after that row and everything nested under it, dragging UP
 * puts it before. Always inserting before the target would make every
 * downward drag of an adjacent row do nothing at all.
 */
export function reorderSubtree<T extends HierarchyNode>(
    items: ReadonlyArray<T>, fromId: string, toId: string,
): T[] {
    if (fromId === toId) return [...items];
    const from = items.findIndex((i) => i.id === fromId);
    const to = items.findIndex((i) => i.id === toId);
    if (from < 0 || to < 0) return [...items];
    const block = subtreeOf(items, fromId);
    // Dropping an item inside its own subtree is the ONE gesture that can mint
    // a cycle. Refuse it here rather than repair it after the fact.
    if (block.includes(toId)) return [...items];
    if (from > to) return spliceSubtree(items, block, toId);
    // Moving down: land after the target's own subtree, never inside it.
    const moving = new Set(block);
    const targetBlock = subtreeOf(items, toId);
    const lastOfTarget = targetBlock[targetBlock.length - 1];
    const rest = items.filter((i) => !moving.has(i.id));
    const lastIdx = rest.findIndex((i) => i.id === lastOfTarget);
    const anchor = lastIdx >= 0 && lastIdx + 1 < rest.length ? rest[lastIdx + 1].id : null;
    return spliceSubtree(items, block, anchor);
}

/**
 * Move an item (with its subtree) one place up/down AMONG ITS OWN SIBLINGS.
 *
 * The edge is the end of the item's own sibling run, not the end of the array:
 * the last child of a parent has nowhere to go down to, even though there are
 * rows below it in the section.
 */
export function moveSubtreeAmongSiblings<T extends HierarchyNode>(
    items: ReadonlyArray<T>, id: string, dir: -1 | 1,
): T[] {
    const byId = new Map(items.map((i) => [i.id, i]));
    const self = byId.get(id);
    if (!self) return [...items];
    const siblings = childrenOf(items, resolvedParent(self, byId));
    const at = siblings.findIndex((s) => s.id === id);
    const target = at + dir;
    if (at < 0 || target < 0 || target >= siblings.length) return [...items];
    return reorderSubtree(items, id, siblings[target].id);
}

/** Remove an item and everything under it. */
export function deleteSubtree<T extends HierarchyNode>(
    items: ReadonlyArray<T>, id: string,
): T[] {
    const gone = new Set(subtreeOf(items, id));
    return items.filter((i) => !gone.has(i.id));
}

/** Rewrite parent pointers through `idMap`; anything the map misses becomes top level. */
export function remapParentIds<T extends HierarchyNode>(
    items: ReadonlyArray<T>, idMap: ReadonlyMap<string, string>,
): T[] {
    return items.map((item) => {
        const parentId = item.parentId ?? null;
        if (!parentId) return { ...item, parentId: null };
        const mapped = idMap.get(parentId);
        // No mapping means the parent did not come along. Keeping the old id
        // would leave a pointer into another section, which no reader resolves.
        return { ...item, parentId: mapped ?? null };
    });
}

/** Clone a subtree with fresh ids, inserted right after the source subtree. */
export function duplicateSubtree<T extends HierarchyNode>(
    items: ReadonlyArray<T>, id: string, mintId: () => string,
): T[] {
    const block = subtreeOf(items, id);
    if (block.length === 0) return [...items];
    const byId = new Map(items.map((i) => [i.id, i]));
    const idMap = new Map(block.map((oldId) => [oldId, mintId()]));
    const root = byId.get(id);
    const rootParent = root ? resolvedParent(root, byId) : null;
    const clones = block.map((oldId) => {
        const source = byId.get(oldId) as T;
        const oldParent = resolvedParent(source, byId);
        return {
            ...source,
            id: idMap.get(oldId) as string,
            parentId: oldId === id ? rootParent : (idMap.get(oldParent ?? '') ?? null),
        };
    });
    const lastIdx = items.findIndex((i) => i.id === block[block.length - 1]);
    return [...items.slice(0, lastIdx + 1), ...clones, ...items.slice(lastIdx + 1)];
}

const TOP_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** `A`, `AA`, ... for a 0-based top-level position. */
function topLabel(index: number): string {
    let n = index;
    let out = '';
    do {
        out = TOP_ALPHABET[n % 26] + out;
        n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return out;
}

/**
 * The outline number to print beside each row: `A`, `A.1`, `A.1.a`.
 *
 * DERIVED, never stored. `TemplateItem.number` is a separate, author-written
 * field and the two must not compete: this one describes position in the tree,
 * that one is whatever the author typed.
 *
 * A number survives truncation, which is why it earns its place beside the
 * indent: the item column is 280px wide and the label is `truncate`d.
 */
export function outlineNumbers<T extends HierarchyNode>(
    items: ReadonlyArray<T>,
): Map<string, string> {
    const out = new Map<string, string>();
    const label = (depth: number, index: number): string =>
        depth === 0 ? topLabel(index)
        : depth === 1 ? String(index + 1)
        : TOP_ALPHABET[index % 26].toLowerCase();
    const walk = (parentId: string | null, prefix: string, depth: number) => {
        childrenOf(items, parentId).forEach((child, index) => {
            const own = label(depth, index);
            const full = prefix ? `${prefix}.${own}` : own;
            out.set(child.id, full);
            if (depth + 1 < MAX_ITEM_DEPTH) walk(child.id, full, depth + 1);
        });
    };
    walk(null, '', 0);
    for (const item of items) if (!out.has(item.id)) out.set(item.id, '');
    return out;
}
