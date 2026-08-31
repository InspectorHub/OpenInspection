/**
 * The write boundary for template item hierarchy.
 *
 * The editor also refuses to build a fourth level, but that is convenience.
 * This is the guarantee: a hand-written PUT is the surface that has to hold.
 */
import { describe, it, expect } from 'vitest';
import { CreateTemplateSchema } from '../../../server/lib/validations/template.schema';

const item = (id: string, parentId?: string | null) => ({
    id, label: id, type: 'boolean' as const,
    ...(parentId === undefined ? {} : { parentId }),
});

const doc = (items: unknown[]) => ({
    name: 'T',
    schema: { schemaVersion: 2, sections: [{ id: 's1', title: 'S', items }] },
});

/** Every issue message the parse produced, lower-cased, as one string. */
const why = (result: { success: boolean; error?: { issues: unknown[] } }) =>
    JSON.stringify(result.error?.issues ?? []).toLowerCase();

describe('template item hierarchy - write schema', () => {
    it('ACCEPTS a template exactly three levels deep', () => {
        // The positive control. Every refusal below is worthless without it:
        // a validator that rejected all templates would pass them all.
        const r = CreateTemplateSchema.safeParse(doc([
            item('a', null), item('a1', 'a'), item('a1x', 'a1'),
        ]));
        expect(r.success).toBe(true);
    });

    it('ACCEPTS a flat template that never mentions parentId', () => {
        // Every template stored before this field existed. If this ever fails,
        // the field stopped being optional and every stored document is a 400.
        const r = CreateTemplateSchema.safeParse(doc([item('a'), item('b')]));
        expect(r.success).toBe(true);
    });

    it('REFUSES a fourth level, and names the item', () => {
        const r = CreateTemplateSchema.safeParse(doc([
            item('a', null), item('a1', 'a'), item('a1x', 'a1'), item('deep', 'a1x'),
        ]));
        expect(r.success).toBe(false);
        expect(why(r)).toContain('deep');
        // ...and for the RIGHT reason. `.strict()` refuses an unknown key with
        // the same `success: false`, so a run where parentId never reached the
        // schema at all would pass the assertion above having tested nothing.
        expect(why(r)).toContain('nests deeper');
        expect(why(r)).not.toContain('unrecognized_keys');
    });

    it('REFUSES a cycle, and says cycle rather than too deep', () => {
        // Order matters: a depth walk on a cycle never terminates, so the cycle
        // check has to run first. If this message says "too deep" the two
        // checks are in the wrong order and the error sends the author to fix
        // the wrong thing.
        const r = CreateTemplateSchema.safeParse(doc([
            item('a', 'b'), item('b', 'a'),
        ]));
        expect(r.success).toBe(false);
        expect(why(r)).toContain('cycle');
        expect(why(r)).not.toContain('nests deeper');
    });

    it('REFUSES an item that is its own parent', () => {
        const r = CreateTemplateSchema.safeParse(doc([item('a', 'a')]));
        expect(r.success).toBe(false);
        expect(why(r)).toContain('cycle');
    });

    it('REFUSES a parentId that names no item in the same section', () => {
        // Readers fail open to flat, but the write boundary should not accept
        // a pointer it can already see is broken.
        const r = CreateTemplateSchema.safeParse(doc([item('a', 'nowhere')]));
        expect(r.success).toBe(false);
        expect(why(r)).toContain('nowhere');
        expect(why(r)).toContain('not an item in this section');
    });

    it('REFUSES an empty-string parentId', () => {
        // '' is truthy-checked as "has a parent" and lookup-checked as "no
        // parent". Killing it at the boundary is cheaper than defending it in
        // every reader.
        expect(CreateTemplateSchema.safeParse(doc([item('a', '')])).success).toBe(false);
    });

    it('ACCEPTS an explicit null parentId', () => {
        // Positive control for the two refusals above: null is how the editor
        // says "top level" when it serializes a previously-nested item.
        expect(CreateTemplateSchema.safeParse(doc([item('a', null)])).success).toBe(true);
    });

    it('does not let a parent in ANOTHER section resolve', () => {
        const r = CreateTemplateSchema.safeParse({
            name: 'T',
            schema: { schemaVersion: 2, sections: [
                { id: 's1', title: 'A', items: [item('a', null)] },
                { id: 's2', title: 'B', items: [item('b', 'a')] },
            ] },
        });
        expect(r.success).toBe(false);
        expect(why(r)).toContain('not an item in this section');
    });
});
