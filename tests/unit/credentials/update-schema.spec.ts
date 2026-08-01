/**
 * A PATCH must carry exactly the fields the caller sent.
 *
 * `UpdateCredentialSchema` used to be `CreateCredentialSchema.partial()`, and
 * `.partial()` does not remove a `.default()` — it wraps it. So a body naming
 * one field came out of validation naming two, and `CredentialService.update`
 * writes every key that is not `undefined`. Renaming a member number blanked
 * the label; so did reordering the list, which is how this was found: the
 * reorder control saved the order and quietly emptied every label with it.
 *
 * These assert the ABSENCE of keys, which is the property that broke. Asserting
 * the parsed values would have passed the whole time.
 */
import { describe, it, expect } from 'vitest';
import { CreateCredentialSchema, UpdateCredentialSchema } from '../../../server/lib/validations/credential.schema';

describe('UpdateCredentialSchema', () => {
    it('adds no key the caller did not send', () => {
        expect(Object.keys(UpdateCredentialSchema.parse({ sortOrder: 0 }))).toEqual(['sortOrder']);
        expect(Object.keys(UpdateCredentialSchema.parse({ memberNumber: 'TX-1' }))).toEqual(['memberNumber']);
        expect(Object.keys(UpdateCredentialSchema.parse({}))).toEqual([]);
    });

    it('never synthesises an empty label', () => {
        // The exact shape of the bug: reordering wrote label ''.
        expect(UpdateCredentialSchema.parse({ sortOrder: 3 })).not.toHaveProperty('label');
    });

    it('still passes through a label the caller DID send, including a blank one', () => {
        // Clearing a label on purpose has to keep working — the fix is about
        // what is absent, not about refusing empty strings.
        expect(UpdateCredentialSchema.parse({ label: '' })).toEqual({ label: '' });
        expect(UpdateCredentialSchema.parse({ label: 'InterNACHI CPI' })).toEqual({ label: 'InterNACHI CPI' });
    });

    it('lets memberNumber be nulled explicitly', () => {
        expect(UpdateCredentialSchema.parse({ memberNumber: null })).toEqual({ memberNumber: null });
    });

    it('leaves CREATE defaulting its label — a new row genuinely has none', () => {
        // The default is right where it lives; it was only wrong once `.partial()`
        // carried it into a patch.
        expect(CreateCredentialSchema.parse({})).toMatchObject({ label: '' });
    });
});
