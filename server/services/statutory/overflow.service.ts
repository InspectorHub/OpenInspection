/**
 * The repeated-block instances an authority's form has no slot to print.
 *
 * -- WHY THIS IS A SEPARATE HOME --------------------------------------------
 * Slots the form prints are ordinary template items: the inspector fills them
 * in the normal editor and their values reach the form as bindings. An instance
 * past `capacity` has no item, because there is nothing on the page for an item
 * to correspond to -- so it cannot live in the inspection results, and it is
 * kept here per (tenant, inspection, form) instead.
 *
 * -- THE KEY SHAPE IS THE ONE THE BINDINGS USE -------------------------------
 * `electrical_panel[2].total_amps`. One vocabulary, two places: the same string
 * a declaration would have written had the page had a third box. Inventing a
 * second shape here would mean translating between them, and a translation is
 * somewhere for the two to drift.
 *
 * -- WHAT THIS TABLE HOLDS, AND WHAT IT NO LONGER HOLDS ----------------------
 * It was designed to hold "a form's answers". It does not: answers come from
 * the inspection's own items. What is left for it is exactly what the item
 * model cannot express, which is a narrower job than it was given and a better
 * argued one.
 *
 * -- NO PERSONAL DATA -------------------------------------------------------
 * The same declaration as the printed slots make: what lands here is amperage,
 * panel age, brand -- property facts. Client identity reaches a form through
 * `from: 'inspection'` bindings and never through this table.
 */
import { and, eq } from 'drizzle-orm';
import { statutoryFormEntries } from '../../lib/db/schema';
import type { FieldGroup } from '../../types/template-schema';
import type { StatutoryGroupInstances } from '../../lib/statutory/values';

/**
 * Refuse a write aimed at a slot the page prints.
 *
 * Those slots take their value from a binding, which is the authority for them.
 * Accepting a second writer would give one box two sources with nothing to say
 * which the form carried -- and the losing value would not be missing, it would
 * be invisible.
 */
export function refuseIndexInsidePrintedRange(group: FieldGroup, index: number): void {
    if (index < group.capacity) {
        const slot = group.slotLabels[index] ?? `slot ${index}`;
        throw new Error(
            `statutory overflow: "${slot}" is printed on this form, so its value comes from `
            + `the inspection's own item. Only instances from ${group.capacity} upward are `
            + 'recorded here.',
        );
    }
}

/** `electrical_panel[2].total_amps` -> its three parts, or null. */
const KEY = /^([A-Za-z0-9_]+)\[(\d+)\]\.(.+)$/;

type Values = Record<string, string>;

export class StatutoryOverflowService {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(private db: any) {}

    private async row(tenantId: string, inspectionId: string, formId: string) {
        return this.db.select().from(statutoryFormEntries)
            .where(and(
                eq(statutoryFormEntries.tenantId, tenantId),
                eq(statutoryFormEntries.inspectionId, inspectionId),
                eq(statutoryFormEntries.formId, formId),
            ))
            .get();
    }

    /**
     * Every recorded instance, in the shape `collectStatutoryValues` takes.
     *
     * An index is a POSITION, not an ordinal: an instance recorded at index 3
     * comes back at index 3, with the earlier positions present and empty. They
     * belong to printed slots supplied by bindings, and collapsing the array
     * would slide a third panel into the Main Panel's place -- a value that is
     * wrong in a way no count of "instances recorded" can show.
     */
    async instancesFor(
        tenantId: string, inspectionId: string, formId: string,
    ): Promise<StatutoryGroupInstances> {
        const row = await this.row(tenantId, inspectionId, formId);
        if (!row) return {};
        const values = (row.values ?? {}) as Values;

        const byGroup: Record<string, Record<string, string>[]> = {};
        for (const [key, value] of Object.entries(values)) {
            const parsed = KEY.exec(key);
            if (!parsed) continue;
            const [, groupId, rawIndex, field] = parsed;
            const index = Number(rawIndex);
            const slots = byGroup[groupId] ?? (byGroup[groupId] = []);
            while (slots.length <= index) slots.push({});
            slots[index][field] = value;
        }
        return byGroup;
    }

    /**
     * Record one instance's fields at `index`, merging with whatever is there.
     *
     * Merging rather than replacing, because the inspector fills a panel one
     * field at a time and a save that dropped the fields it was not given would
     * lose the answer he typed a moment ago.
     */
    async addInstance(
        tenantId: string, inspectionId: string, formId: string,
        groupId: string, index: number, fields: Record<string, string>,
    ): Promise<void> {
        const row = await this.row(tenantId, inspectionId, formId);
        const values: Values = { ...((row?.values ?? {}) as Values) };
        for (const [field, value] of Object.entries(fields)) {
            values[`${groupId}[${index}].${field}`] = value;
        }
        const now = new Date();
        if (row) {
            await this.db.update(statutoryFormEntries)
                .set({ values, updatedAt: now })
                .where(eq(statutoryFormEntries.id, row.id));
            return;
        }
        await this.db.insert(statutoryFormEntries).values({
            id: crypto.randomUUID(),
            tenantId, inspectionId, formId, values, updatedAt: now,
        });
    }
}
