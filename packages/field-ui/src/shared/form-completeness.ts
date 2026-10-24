/**
 * How much of a statutory form the inspection has answered.
 *
 * -- WHY THIS COUNTS BINDINGS AND NOT ITEMS ----------------------------------
 * An inspection carries items no binding points at, and it can carry a form
 * whose every box is bound to an item the inspector has not reached. Counting
 * items would move the number without moving the form; counting bound items is
 * the only reading that answers "how much of the document is filled in".
 *
 * -- WHY IT IS COMPUTED HERE AND NOT ASKED FOR -------------------------------
 * Everything it needs is already on the screen: which items the declaration
 * binds, and what the editor has for them. Asking the server would put a round
 * trip between typing an answer and seeing the count move, and this number's
 * whole job is to be visible while filling rather than at the end.
 *
 * -- WHAT IT IS NOT ----------------------------------------------------------
 * Not the form's own required-field list, which lives in the field map beside
 * the coordinates and is a property of one revision. That list is the authority
 * on whether a form may be produced at all, and the renderer already refuses
 * against it. This is the inspector's running count, not the gate.
 */

/** A result as the editor holds it: keyed `unitId:sectionId:itemId`. */
type Results = Record<string, { value?: unknown; rating?: unknown } | undefined>;

export interface FormCompleteness {
    answered: number;
    total: number;
}

/** The item id is the last segment of `unitId:sectionId:itemId`. */
function itemIdOf(key: string): string {
    const parts = key.split(':');
    return parts[parts.length - 1];
}

function isAnswered(entry: { value?: unknown; rating?: unknown } | undefined): boolean {
    // An empty string is a box someone cleared, not a box someone filled. On a
    // statutory form that difference is the whole point, so it is not an answer.
    const value = entry?.rating ?? entry?.value;
    if (value === undefined || value === null) return false;
    if (typeof value === 'string') return value.trim() !== '';
    if (Array.isArray(value)) return value.length > 0;
    return true;
}

/**
 * Answered and total, counting each bound item once.
 *
 * Per-unit mode keys one item under several unit scopes; the form has one box
 * for it either way, so an item answered in any scope counts once.
 */
export function formCompleteness(boundItemIds: Set<string>, results: Results): FormCompleteness {
    const answered = new Set<string>();
    for (const [key, entry] of Object.entries(results)) {
        const itemId = itemIdOf(key);
        if (!boundItemIds.has(itemId)) continue;
        if (isAnswered(entry)) answered.add(itemId);
    }
    return { answered: answered.size, total: boundItemIds.size };
}
