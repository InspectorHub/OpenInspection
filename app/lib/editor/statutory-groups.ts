/**
 * What the editor needs to know about a template's statutory groups.
 *
 * -- THE PRINTED SLOTS NEED NO NEW STORAGE ------------------------------------
 * A binding key already carries the whole answer: `electrical_panel[0]
 * .total_amps` names the group, the slot and the field, and the binding points
 * at the template item holding it. So "which items make up Main Panel" is a
 * question the declaration can already answer, and this module only reads it
 * back out. Nothing about a printed slot is stored twice.
 *
 * -- WHY THE EDITOR HAS TO KNOW AT ALL ---------------------------------------
 * Without this the group is invisible: the items render as a flat run
 * distinguished only by a label prefix, and the two most natural gestures for
 * adding a third panel -- "Add item" and "Duplicate" -- both mint a NEW item id.
 * A binding points at a specific id, so the value an inspector then types
 * reaches no form at all, and nothing tells him. That silent drop is the failure
 * this whole subsystem exists to prevent, arriving through the friendliest
 * button on the screen.
 *
 * -- WHAT IS DELIBERATELY NOT HERE -------------------------------------------
 * Instances past `capacity`. They have no template item, because the authority's
 * page has no slot to print them in; they live per-inspection and are routed
 * into the form's own comments box. This module describes what the form prints.
 */
import type {
    FieldGroup,
    StatutoryFormDeclaration,
} from '../../../server/types/template-schema';

/** One slot the authority's page actually prints. */
export interface EditorGroupSlot {
    /** 0-based position. Slot 0 is the first the form prints, not "the first one found". */
    index: number;
    /** What the form prints over it, verbatim -- "Main Panel", not "Panel 1". */
    label: string;
    /** Field name inside the instance -> the template item holding it. */
    fields: Record<string, string>;
}

/** A repeated block, as the editor needs to render it. */
export interface EditorGroup {
    id: string;
    label: string;
    capacity: number;
    slots: EditorGroupSlot[];
    /** The form's own field that receives instances past capacity, if it has one. */
    overflowTo?: string;
}

/** `electrical_panel[0].total_amps` -> its three parts, or null if not a group key. */
function parseGroupKey(key: string): { groupId: string; index: number; field: string } | null {
    const match = /^([A-Za-z0-9_]+)\[(\d+)\]\.(.+)$/.exec(key);
    if (!match) return null;
    return { groupId: match[1], index: Number(match[2]), field: match[3] };
}

function slotsOf(group: FieldGroup, declaration: StatutoryFormDeclaration): EditorGroupSlot[] {
    const slots: EditorGroupSlot[] = Array.from({ length: group.capacity }, (_, index) => ({
        index,
        label: group.slotLabels[index] ?? `${group.label} ${index + 1}`,
        fields: {},
    }));
    for (const [key, source] of Object.entries(declaration.bindings)) {
        // Only `item` sources have something the editor can point a person at.
        // A literal or an inspection column resolves at render time with no
        // field for anybody to fill, so it is not a gap -- it is not ours.
        if (source.from !== 'item') continue;
        const parsed = parseGroupKey(key);
        if (!parsed || parsed.groupId !== group.id) continue;
        const slot = slots[parsed.index];
        if (!slot) continue;               // a binding past capacity: the map's problem, not the editor's
        slot.fields[parsed.field] = source.itemId;
    }
    return slots;
}

/**
 * The groups this template declares, resolved against its bindings.
 *
 * Empty when the template declares no form or no groups -- which is the ordinary
 * case, and is what leaves a narrative template's editor untouched.
 */
export function deriveEditorGroups(
    declaration: StatutoryFormDeclaration | undefined,
): EditorGroup[] {
    if (!declaration?.groups) return [];
    return declaration.groups.map((group) => ({
        id: group.id,
        label: group.label,
        capacity: group.capacity,
        slots: slotsOf(group, declaration),
        ...(group.overflowTo === undefined ? {} : { overflowTo: group.overflowTo }),
    }));
}

/**
 * Every template item some binding points at.
 *
 * The editor uses this to answer "would a new item reach the form" -- it would
 * not, because a binding names an id that does not exist yet. An empty set means
 * this template declares no form, and the editor behaves exactly as it always
 * has.
 */
export function formBoundItemIds(
    declaration: StatutoryFormDeclaration | undefined,
): Set<string> {
    const ids = new Set<string>();
    if (!declaration) return ids;
    for (const source of Object.values(declaration.bindings)) {
        if (source.from === 'item') ids.add(source.itemId);
    }
    return ids;
}

/**
 * Does this inspection's snapshot declare a statutory form at all?
 *
 * Not the same question as "does it have groups". The server refuses EVERY
 * structural edit on such an inspection -- add, rename, duplicate, delete, move,
 * reorder, rating-system swap -- with a 403 raised ahead of the body validator,
 * because the declaration is platform-supplied and a round-tripped snapshot
 * would carry it back through a tenant surface that must not accept it.
 *
 * So the editor stops OFFERING those controls. A control that always fails is
 * the same class of defect as one that silently does nothing: the inspector
 * learns the hard way, mid-job, and has no idea why. The Florida
 * wind-mitigation form declares no groups and its inspections are just as
 * read-only, which is why this is asked separately.
 */
export function declaresStatutoryForm(snapshot: unknown): boolean {
    return Boolean((snapshot as { statutoryForm?: unknown } | null | undefined)?.statutoryForm);
}
