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
import { CONTAINER_VENDORS, TABULAR_VENDOR } from '../../server/lib/migration-intake/adapters/source';
import { VENDOR_IDS } from '../../server/lib/migration-intake/bundle';
import { defaultImportSourceFor, importSourcesFor, sourceIsTabular } from './import-sources';

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

    it('says a source is tabular when and only when it is the vendor read as text', () => {
        // Same treatment as `readHere`, for the same reason and against a
        // different pair of facts. This flag decides whether the BROWSER may
        // flatten a chosen workbook to one sheet of CSV — and doing that to a
        // Spectora export, which the reader opens as a zip itself, would
        // destroy it.
        //
        // ⚠️ The check is `=== TABULAR_VENDOR`, NOT `!CONTAINER_VENDORS`. The
        // two lists are not complements: `homegauge` is on neither, because
        // nothing here reads it at all. Default-deny is the only safe
        // direction for a rule that licenses rewriting somebody's file — a
        // vendor whose reader has not been written yet must not become
        // convertible by being absent from a list.
        const seen = new Set<string>();
        for (const intent of ['templates.create', 'contacts.import', 'members.invite'] as const) {
            for (const source of importSourcesFor(intent)) {
                seen.add(source.vendor);
                expect(source.tabular).toBe(source.vendor === TABULAR_VENDOR);
                // And, said the other way: a container vendor is never tabular.
                if (CONTAINER_VENDORS.includes(source.vendor)) {
                    expect(source.tabular).toBe(false);
                }
            }
        }
        // Positive controls, both directions: an equality that never meets a
        // false case proves nothing, and one that never meets a true case
        // proves only that the flag is off everywhere.
        expect([...seen].some((v) => v === TABULAR_VENDOR)).toBe(true);
        expect([...seen].some((v) => v !== TABULAR_VENDOR)).toBe(true);
        expect([...seen].some((v) => CONTAINER_VENDORS.includes(v as never))).toBe(true);
    });
});

describe('sourceIsTabular', () => {
    it('is true for the spreadsheet entry, which reads text', () => {
        expect(sourceIsTabular('contacts.import', 'csv_generic')).toBe(true);
        expect(sourceIsTabular('members.invite', 'csv_generic')).toBe(true);
    });

    it('is false for a vendor whose export is a container', () => {
        // The boundary rule. A Spectora `.xlsx` is a package the server opens
        // itself; one sheet of it is not that file.
        expect(sourceIsTabular('templates.create', 'spectora')).toBe(false);
        expect(sourceIsTabular('templates.create', 'home_inspector_pro')).toBe(false);
    });

    it('is false where no vendor was declared at all', () => {
        // The assisted entry offers no source, so nothing there can be called
        // tabular — which is exactly what keeps the raw-workbook escape hatch
        // reachable: that entry never converts.
        expect(sourceIsTabular('assisted.full', null)).toBe(false);
    });

    it('is false for a vendor this entry point does not offer', () => {
        // Tabular-ness is a property of a source AT AN ENTRY POINT, not of a
        // vendor name floating free. A field carrying `spectora` on the
        // contacts entry is not a declaration this entry accepts, so it is
        // certainly not a licence to convert.
        expect(sourceIsTabular('contacts.import', 'spectora')).toBe(false);
        expect(sourceIsTabular('templates.create', 'csv_generic')).toBe(false);
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
