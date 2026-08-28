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
 * -- WHY THERE ARE TWO REFUSALS AND WHICH ONE APPLIES ------------------------
 * A group may nominate a field on the same form to receive what the slots could
 * not hold, and most forms have one: the Citizens four-point form prints "(use
 * additional pages if needed)" on its Additional Comments box, which is the
 * publisher's own answer to where a third panel goes. So a group WITH a
 * destination is not refused for being over capacity — the extra instances are
 * written there, and `refuseOverflowThatDoesNotFit` refuses only when that box
 * cannot hold them either. A group WITHOUT one is refused by `refuseOverCapacity`
 * exactly as before, because there is genuinely nowhere: the Florida
 * wind-mitigation form carries no comments field at all.
 *
 * -- WHY EVERY MESSAGE CARRIES BOTH NUMBERS AND A NEXT STEP -----------------
 * They are read in a garage, not in a log. "Too many panels" tells somebody he
 * is stuck; the count he recorded, the count the form has, and where the rest go
 * tell him what to do next. The second refusal adds the box that was tried,
 * because otherwise he has no way to know one was.
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
        validateOverflow(group);
    }
}

/** The destination half of one group's declaration. */
function validateOverflow(group: FieldGroup): void {
    if (group.overflowTo !== undefined) {
        if (group.overflowTo === '') {
            fail(`"${group.id}" declares an empty overflow destination; omit the key when the `
                + 'form has no field that can receive an extra instance');
        }
        // A group that overflows into one of its own slots would append the
        // extra instance onto a value the page prints somewhere else, and the
        // box it landed in would still look like a correctly filled slot.
        if (expectedGroupFields([group]).includes(group.overflowTo)) {
            fail(`"${group.id}" overflows into "${group.overflowTo}", which is one of its own `
                + 'slots; the destination is a separate field on the form');
        }
    }
    if (group.overflowMaxLength !== undefined) {
        if (group.overflowTo === undefined) {
            fail(`"${group.id}" measures an overflow destination but names none`);
        }
        if (!(group.overflowMaxLength > 0)) {
            fail(`"${group.id}" declares an overflow destination holding `
                + `${group.overflowMaxLength} characters; a box that holds nothing is not a `
                + 'destination');
        }
    }
}

/**
 * Refuse an inspection that recorded more instances than the form can hold.
 *
 * `recorded` is how many the inspection has, not how many were bound. This is
 * the refusal for a group with NOWHERE to put the extra; where the form
 * nominates a destination the instances go there instead, and
 * `refuseOverflowThatDoesNotFit` is the one that can still stop the document.
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

/**
 * Refuse an overflow the nominated destination cannot hold either.
 *
 * The last link of the chain: extra instance -> the field the form nominates ->
 * that field cannot hold it -> refuse. Silence here would be the same failure as
 * a dropped third panel, one box further along.
 *
 * `received` is the length of the WHOLE value the box would end up with,
 * including whatever the inspector already wrote there — the box holds one text,
 * not two, so a check against our addition alone would pass and the page would
 * still overrun.
 */
export function refuseOverflowThatDoesNotFit(
    group: FieldGroup, recorded: number, destination: string, received: number,
): void {
    const holds = group.overflowMaxLength;
    // Unmeasured is not unlimited: `fit.ts` measures the box against the font at
    // render time and refuses there. See `FieldGroup.overflowMaxLength`.
    if (holds === undefined || received <= holds) return;
    const extra = recorded - group.capacity;
    throw new Error(
        `${group.label}: this inspection recorded ${recorded}, and this revision of the form `
        + `has ${group.capacity} slots. The remaining ${extra} will not fit in "${destination}" `
        + `either: that box holds about ${holds} characters and would receive ${received}. `
        + 'Record the remainder in the narrative report or as an attachment.',
    );
}
