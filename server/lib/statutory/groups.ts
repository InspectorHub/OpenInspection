/**
 * Repeated blocks on an authority's form -- expanding them, and refusing more
 * than the page can hold.
 *
 * -- WHY OVER-CAPACITY IS A REFUSAL AND NOT A TRUNCATION ---------------------
 * A silently dropped third panel comes out of the renderer as an empty slot, and
 * an empty slot on a statutory form reads exactly like an inspector who did not
 * answer. That is the failure this whole subsystem exists to prevent, so the
 * overflow stops the render and says so.
 *
 * -- WHY THE MESSAGE CARRIES BOTH NUMBERS AND A NEXT STEP --------------------
 * It is read in a garage, not in a log. "Too many panels" tells somebody he is
 * stuck; the count he recorded, the count the form has, and where the rest go
 * tell him what to do next.
 */
import type { FieldGroup } from '../../types/template-schema';

function fail(reason: string): never {
    throw new Error(`statutory group: ${reason}`);
}

/** `electrical_panel[0].total_amps` -- positional underneath, named on screen. */
export function groupFieldName(groupId: string, index: number, field: string): string {
    return `${groupId}[${index}].${field}`;
}

/** Every field name a declaration's groups are expected to bind. */
export function expectedGroupFields(groups: readonly FieldGroup[]): string[] {
    const names: string[] = [];
    for (const group of groups) {
        for (let i = 0; i < group.capacity; i++) {
            for (const field of group.fields) {
                names.push(groupFieldName(group.id, i, field));
            }
        }
    }
    return names;
}

/** Throw unless every group is well-formed. Called before a map is trusted. */
export function validateGroups(groups: readonly FieldGroup[]): void {
    const seen = new Set<string>();
    for (const group of groups) {
        if (seen.has(group.id)) fail(`duplicate group id "${group.id}"`);
        seen.add(group.id);
        if (group.capacity < 1) {
            fail(`"${group.id}" declares capacity ${group.capacity}; a group has at least one slot`);
        }
        if (group.slotLabels.length !== group.capacity) {
            fail(`"${group.id}" declares ${group.capacity} slot(s) but `
                + `${group.slotLabels.length} label(s); every slot carries the name the form `
                + 'prints over it');
        }
        if (group.fields.length === 0) fail(`"${group.id}" declares no fields`);
    }
}

/**
 * Refuse an inspection that recorded more instances than the form can hold.
 *
 * `recorded` is how many the inspection has, not how many were bound.
 */
export function refuseOverCapacity(group: FieldGroup, recorded: number): void {
    if (recorded <= group.capacity) return;
    const extra = recorded - group.capacity;
    throw new Error(
        `${group.label}: this inspection recorded ${recorded}, and this revision of the form `
        + `has ${group.capacity} slots. Record the remaining ${extra} in the narrative report `
        + 'or as an attachment.',
    );
}
