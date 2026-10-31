import * as Y from 'yjs';

/** Names one photo of an upload batch: its stored `key`, or the `pendingId` of the entry a host wrote when it kept the file. */
export interface BatchPhotoName {
    key?: string;
    pendingId?: string;
}

function matches(el: Y.Map<unknown>, name: BatchPhotoName): boolean {
    return name.key ? el.get('key') === name.key : !!name.pendingId && el.get('pendingId') === name.pendingId;
}

/**
 * Put the photos of one upload batch back in the order the user selected them. `selection` lists the batch's photos in
 * selection order. The batch's elements swap places among the slots they already occupy; every other photo of the
 * finding keeps its index, and a slot that already holds the right element is not touched. Read-only when nothing needs
 * to move: it never creates the finding or the array and opens no transaction.
 *
 * Known limits, accepted: a kept file whose pending entry was already resolved to a key (and lost its `pendingId`)
 * before the batch settled can no longer be found by its pendingId and stays where it is; two batches of one item
 * settling interleaved are each ordered on their own; photos pinned to a defect row are not reordered.
 */
export function orderPhotoBatch(
    doc: Y.Doc,
    findingKey: string,
    selection: ReadonlyArray<BatchPhotoName>,
): void {
    const item = doc.getMap<unknown>('results').get(findingKey);
    if (!(item instanceof Y.Map)) return;
    const arr = item.get('photos');
    if (!(arr instanceof Y.Array)) return;

    const elements: Array<Y.Map<unknown>> = [];
    const slots: number[] = [];
    for (const name of selection) {
        for (let i = 0; i < arr.length; i++) {
            const el = arr.get(i);
            if (!(el instanceof Y.Map) || slots.includes(i) || !matches(el, name)) continue;
            slots.push(i);
            elements.push(el);
            break;
        }
    }
    slots.sort((a, b) => a - b);
    const moves = slots.filter((slot, n) => arr.get(slot) !== elements[n]);
    if (moves.length === 0) return;

    doc.transact(() => {
        // Snapshot first: a Y.Map that is deleted can no longer be read.
        const copies = new Map<number, Record<string, unknown>>();
        for (const slot of moves) copies.set(slot, elements[slots.indexOf(slot)].toJSON() as Record<string, unknown>);
        for (const slot of moves) {
            const el = new Y.Map<unknown>();
            for (const [k, v] of Object.entries(copies.get(slot) as Record<string, unknown>)) if (v !== undefined) el.set(k, v);
            arr.delete(slot, 1);
            arr.insert(slot, [el]);
        }
    });
}
