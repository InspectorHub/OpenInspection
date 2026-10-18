/**
 * No update schema may inject a value the caller did not send.
 *
 * zod's `.partial()` KEEPS a `.default()`: a schema derived from a create
 * schema that defaults a field parses `{}` to an object that already holds that
 * field, and the handler writes it over the stored value. This repo has lost
 * data that way (contact type, event-type delay, label colours).
 *
 * The check parses an EMPTY body and requires an object with no keys. It is
 * keyed on the absence of the key, never on a value, and it covers every export
 * of `server/lib/validations` named like an update or a patch. A schema that
 * legitimately needs a required field fails the parse and is skipped (nothing
 * can leak from a body that is refused).
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';

const modules = import.meta.glob('../../../server/lib/validations/**/*.ts', { eager: true }) as Record<string, Record<string, unknown>>;

/** The keys an empty body parses to, or null when an empty body is refused. */
function keysOnEmptyBody(schema: z.ZodType): string[] | null {
    const r = schema.safeParse({});
    if (!r.success) return null;
    return r.data && typeof r.data === 'object' ? Object.keys(r.data as object) : [];
}

describe('update and patch schemas', () => {
    const updateSchemas = Object.entries(modules).flatMap(([file, mod]) =>
        Object.entries(mod)
            .filter(([name, value]) => /(^|[a-z])(Update|Patch)[A-Z]/.test(name) && value instanceof z.ZodType)
            .map(([name, value]) => ({ id: `${file.split('validations/')[1]} :: ${name}`, schema: value as z.ZodType })));

    it('finds the update schemas (the walk is not silently empty)', () => {
        expect(updateSchemas.length).toBeGreaterThan(10);
        expect(updateSchemas.map((s) => s.id)).toContain('contact.schema.ts :: UpdateContactSchema');
    });

    it('positive control: the probe flags a `.partial()` that kept a default', () => {
        const leaky = z.object({ type: z.string().default('client'), name: z.string() }).partial();
        expect(keysOnEmptyBody(leaky)).toEqual(['type']);
    });

    it.each(updateSchemas.map((s) => [s.id, s.schema] as const))('%s adds no key to an empty body', (_id, schema) => {
        expect(keysOnEmptyBody(schema) ?? []).toEqual([]);
    });
});
