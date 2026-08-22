/**
 * Which products an entry point accepts an export from.
 *
 * This list replaced a rule that was deleted: the intent used to DECIDE the
 * vendor — `templates.create` meant Spectora, always — so the product could
 * read exactly one vendor's templates and had no way to say so. The operator
 * now declares the source, and this module is the only place that says which
 * declarations an entry point will take.
 *
 * The assertions that matter here COMPARE. "Spectora is offered" is true of a
 * list that offers everything to everybody, so each case is paired with an
 * entry point that must NOT carry the same option, and `readHere` is checked
 * against the adapter registry rather than against itself — a hand-written
 * flag that nothing cross-checks is how a vendor comes to be advertised as
 * readable months after its reader was removed.
 */
import { describe, expect, it } from 'vitest';

import { ADAPTER_VENDORS } from '../../server/lib/migration-intake/adapters/registry';
import { VENDOR_IDS } from '../../server/lib/migration-intake/bundle';
import { defaultImportSourceFor, importSourcesFor } from './import-sources';

describe('importSourcesFor', () => {
    it('offers the three template products on the templates entry', () => {
        expect(importSourcesFor('templates.create').map((s) => s.vendor))
            .toEqual(['spectora', 'home_inspector_pro', 'homegauge']);
    });

    it('offers a spreadsheet, and only that, on the two people entries', () => {
        // The positive control for the case above: if every entry offered every
        // source, the assertion above would be true of a module with no rule in
        // it at all. A contacts file is a table whoever exported it.
        expect(importSourcesFor('contacts.import').map((s) => s.vendor)).toEqual(['csv_generic']);
        expect(importSourcesFor('members.invite').map((s) => s.vendor)).toEqual(['csv_generic']);
    });

    it('offers nothing on the entry for a file whose owner could not name it', () => {
        // Asking "which product is this from" on the entry that exists for
        // "I do not know what this is" is the guess the entry was built to
        // avoid, one question earlier.
        expect(importSourcesFor('assisted.full')).toEqual([]);
    });

    it('names only vendors the stored format can record', () => {
        for (const intent of ['templates.create', 'contacts.import', 'members.invite'] as const) {
            for (const source of importSourcesFor(intent)) {
                expect(VENDOR_IDS).toContain(source.vendor);
            }
        }
    });

    it('says a source is read here when and only when an adapter reads it', () => {
        // The flag decides which sentence the picker prints — "read as you
        // upload it" or "a person converts it by hand" — and it is the one
        // fact on the screen that a reader being added or removed silently
        // falsifies. So it is compared against the registry, not maintained
        // beside it.
        const seen = new Set<string>();
        for (const intent of ['templates.create', 'contacts.import', 'members.invite'] as const) {
            for (const source of importSourcesFor(intent)) {
                seen.add(source.vendor);
                expect(source.readHere).toBe(source.vendor in ADAPTER_VENDORS);
            }
        }
        // Positive control: an equality that never meets a false case is an
        // equality that proves nothing. One offered vendor has no adapter.
        expect([...seen].some((v) => !(v in ADAPTER_VENDORS))).toBe(true);
        expect([...seen].some((v) => v in ADAPTER_VENDORS)).toBe(true);
    });
});

describe('defaultImportSourceFor', () => {
    it('answers the question for an entry point that has only one answer', () => {
        // A radio group of one is not a question. The spreadsheet entry accepts
        // exactly one kind of file, so the declaration is already made.
        expect(defaultImportSourceFor('contacts.import')).toBe('csv_generic');
        expect(defaultImportSourceFor('members.invite')).toBe('csv_generic');
    });

    it('refuses to answer where there is a real choice', () => {
        // This is the whole point. A default here would BE the deleted rule —
        // `templates.create` silently meaning Spectora — with a picker drawn
        // over the top of it.
        expect(defaultImportSourceFor('templates.create')).toBeNull();
    });

    it('answers nothing for the entry that offers nothing', () => {
        expect(defaultImportSourceFor('assisted.full')).toBeNull();
    });
});
