/**
 * The round trip as a PROPERTY: what this product exports, this product can
 * import — without the operator mapping a single column.
 *
 * It is a vitest spec and not a `scripts/check-*.mjs` gate for the reasons
 * `tests/unit/privacy/account-export-classification.spec.ts:1-42` already sets
 * out for the same shape, two of which apply here verbatim: a `.mjs` gate
 * cannot import TypeScript and would have to regex the source, and the
 * interesting failure is BEHAVIOURAL. "Is every field classified" and "does the
 * export actually apply the classification" are the pair that comes apart, and
 * a complete, well-reasoned manifest that nothing reads is precisely the
 * failure the manifest exists to stop reproducing.
 *
 * Every negative assertion here is paired with a positive control in the same
 * result.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createTestDb, setupSchema } from '../db';
import { toD1Binding } from '../helpers/d1-binding';
import { asD1DrizzleReturn, type TestDb } from '../helpers/test-db';
import { DataService } from '../../../server/services/data.service';
import { contacts, tenants } from '../../../server/lib/db/schema';
import { CONTACT_EXCHANGE } from '../../../server/lib/data-exchange/contacts';
import { exportHeaders, roundTripFields } from '../../../server/lib/data-exchange/types';
import { parseCsvTable } from '../../../server/lib/migration-intake/csv';
import {
    defaultMappingFor,
    intakeSourceFromText,
    matchAdapter,
} from '../../../server/lib/migration-intake/adapters/registry';
import { csvGenericAdapter } from '../../../server/lib/migration-intake/adapters/csv-generic';
import { applyContactRow } from '../../../server/services/migration-intake/row-writers';
import type { BundleContact } from '../../../server/lib/migration-intake/bundle';

const TENANT = 'tenant-symmetry';
/** Where the round trip LANDS. A separate tenant, so the write is a create. */
const TARGET = 'tenant-symmetry-target';

/**
 * One seeded contact that exercises every awkward shape at once: a non-default
 * type, a comma inside a value, and a newline inside a value. A fixture whose
 * values are all plain words proves the columns line up and nothing about
 * whether they survive being written and read.
 */
const SEED = {
    id: 'contact-1',
    tenantId: TENANT,
    type: 'agent' as const,
    name: 'Dana Example',
    email: 'dana@example.com',
    phone: '555-0142',
    agency: 'Example Realty, Inc',
    notes: 'Prefers morning calls.\nMet at the Oak Street open house.',
    createdAt: new Date('2026-03-04T09:15:00.000Z'),
};

/** A second row, appended to the export, whose optional cells are BLANK. */
const BLANK_ROW = ',client,Ross Example,ross@example.com,555-0143,,,\n';

let svc: DataService;
let db: TestDb;
beforeEach(async () => {
    const fix = createTestDb();
    db = fix.db;
    await setupSchema(fix.sqlite);
    await fix.db.insert(tenants).values([
        {
            id: TENANT, slug: 'symmetry', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        },
        {
            id: TARGET, slug: 'symmetry-target', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        },
    ]);
    await fix.db.insert(contacts).values(SEED);
    svc = new DataService(toD1Binding(fix.sqlite));
});

/** The header a mapping bound this field to, whichever shape it used. */
function boundHeader(value: unknown): string | null {
    if (typeof value === 'string') return value.length > 0 ? value : null;
    if (value && typeof value === 'object' && 'column' in value) {
        return String((value as { column: string }).column);
    }
    return null;
}

/** The real chain: export → recognise → default mapping. No hand-written file. */
async function mappingForOurOwnExport(csv: string) {
    const source = intakeSourceFromText('contacts-export.csv', csv);
    const match = await matchAdapter('contacts.import', 'csv_generic', source);
    if (!match) throw new Error('our own export was not recognised as a spreadsheet');
    const mapping = defaultMappingFor('contacts.import', match.inspection, source);
    if (mapping.kind !== 'contacts') throw new Error('unreachable');
    return mapping.mapping;
}

describe('contacts export — the header IS the manifest', () => {
    it('writes exactly the manifest headers, in the manifest order', async () => {
        const csv = await svc.exportContactsCSV(TENANT);
        expect(parseCsvTable(csv).columns).toEqual(exportHeaders(CONTACT_EXCHANGE));
    });

    it('POSITIVE CONTROL — the export carries the seeded row under its own headers', async () => {
        // Without this, an export that returned only a header row would
        // satisfy the assertion above while carrying no data at all.
        const table = parseCsvTable(await svc.exportContactsCSV(TENANT));
        expect(table.rows.length).toBeGreaterThan(0);
        expect(table.rows[0].name).toBe('Dana Example');
        expect(table.rows[0].type).toBe('agent');
        expect(table.rows[0].agency).toBe('Example Realty, Inc'); // carries a comma
        // Read off the RAW text rather than the parsed table, because the
        // seeded note carries a newline and the reader cannot yet keep a
        // record together across one — every column after `notes` lands on a
        // row of its own. That is the §7.1 defect, retired in the task that
        // rewrites the tokeniser; here it would only disguise itself as a
        // serialisation failure.
        expect(await svc.exportContactsCSV(TENANT)).toContain('2026-03-04T09:15:00.000Z');
    });
});

describe('contacts round trip — our own export needs no mapping', () => {
    it('binds every roundTrip field to its own header', async () => {
        const mapping = await mappingForOurOwnExport(await svc.exportContactsCSV(TENANT));
        const bound = new Map(
            Object.entries(mapping).map(([k, v]) => [k, boundHeader(v)]),
        );
        for (const f of roundTripFields(CONTACT_EXCHANGE)) {
            expect(bound.get(f.field), `${f.header} should bind to itself`).toBe(f.header);
        }
    });

    it('binds no exportOnly field anywhere', async () => {
        const mapping = await mappingForOurOwnExport(await svc.exportContactsCSV(TENANT));
        const boundHeaders = Object.values(mapping).map(boundHeader).filter(Boolean);
        for (const f of CONTACT_EXCHANGE.fields.filter((x) => x.disposition === 'exportOnly')) {
            expect(boundHeaders).not.toContain(f.header);
        }
        // POSITIVE CONTROL — the same list is not simply empty.
        expect(boundHeaders).toContain('name');
    });

    it('NEGATIVE CONTROL — the same rows under strange headings bind nothing', async () => {
        // The file this property exists to be DIFFERENT from: real data,
        // headings nothing matches, a mapping the operator fills in by hand.
        const strange = 'col1,col2,col3\nDana Example,dana@example.com,555-0142\n';
        const source = intakeSourceFromText('theirs.csv', strange);
        const match = await matchAdapter('contacts.import', 'csv_generic', source);
        const mapping = defaultMappingFor('contacts.import', match!.inspection, source);
        if (mapping.kind !== 'contacts') throw new Error('unreachable');
        expect(mapping.mapping.name).toBe('');
        expect(mapping.mapping.email).toBeUndefined();
    });
});

describe('contacts round trip — the values survive', () => {
    it('reproduces the seeded row field by field', async () => {
        const csv = await svc.exportContactsCSV(TENANT);
        const mapping = await mappingForOurOwnExport(csv);

        const result = await csvGenericAdapter.convert(csv, { entity: 'contact', mapping });
        if (!result.ok) throw new Error(`convert refused the file: ${result.error.code}`);
        expect(result.bundle.contacts).toHaveLength(1);
        // Read through a widened view. `notes` is not a key of BundleContact
        // until the task that threads it through, and an assertion that cannot
        // COMPILE cannot be red for the right reason.
        const entry = result.bundle.contacts[0] as unknown as Record<string, unknown>;

        for (const f of roundTripFields(CONTACT_EXCHANGE)) {
            expect(entry[f.field], `${f.header} did not survive the read`)
                .toBe((SEED as unknown as Record<string, unknown>)[f.field]);
        }
        // Spelled out as well as looped, because these two are what the old
        // design got wrong: a note carrying a newline, and a type the mapping
        // used to answer with a fixed word whatever the file said.
        expect(entry.notes).toBe(SEED.notes);
        expect(entry.type).toBe('agent');
    });
});

describe('contacts round trip — the writer honours the vocabulary', () => {
    /** One staged row, applied through the real write path. */
    async function applyEntry(entry: BundleContact) {
        const row = { payload: JSON.stringify(entry), conflictWith: null } as
            Parameters<typeof applyContactRow>[2];
        const outcome = await applyContactRow(asD1DrizzleReturn(db), TARGET, row, 'overwrite');
        if (outcome.kind !== 'applied') {
            throw new Error(`the write path refused the row: ${JSON.stringify(outcome)}`);
        }
        return outcome.createdId;
    }

    async function storedById(id: string) {
        const stored = await db.select().from(contacts)
            .where(and(eq(contacts.id, id), eq(contacts.tenantId, TARGET))).get();
        if (!stored) throw new Error(`nothing was written for ${id}`);
        return stored as unknown as Record<string, unknown>;
    }

    it('stores what the file said, for every roundTrip field', async () => {
        const csv = await svc.exportContactsCSV(TENANT);
        const mapping = await mappingForOurOwnExport(csv);
        const result = await csvGenericAdapter.convert(csv, { entity: 'contact', mapping });
        if (!result.ok) throw new Error(`convert refused the file: ${result.error.code}`);

        const stored = await storedById(await applyEntry(result.bundle.contacts[0]));
        for (const f of roundTripFields(CONTACT_EXCHANGE)) {
            expect(stored[f.field], `${f.header} did not survive the write`)
                .toBe((SEED as unknown as Record<string, unknown>)[f.field]);
        }
    });

    it('POSITIVE CONTROL — a cell the file left blank is stored as null, not as the row before it', async () => {
        // Without this, "it wrote something" passes for "it wrote THIS": a
        // writer that carried the previous row's agency forward would satisfy
        // every assertion above.
        const csv = await svc.exportContactsCSV(TENANT) + '\n' + BLANK_ROW;
        const mapping = await mappingForOurOwnExport(csv);
        const result = await csvGenericAdapter.convert(csv, { entity: 'contact', mapping });
        if (!result.ok) throw new Error(`convert refused the file: ${result.error.code}`);
        expect(result.bundle.contacts).toHaveLength(2);

        const first = await storedById(await applyEntry(result.bundle.contacts[0]));
        const second = await storedById(await applyEntry(result.bundle.contacts[1]));
        expect(second.name).toBe('Ross Example');
        expect(first.agency).toBe(SEED.agency);
        expect(second.agency).toBeNull();
        expect(second.notes).toBeNull();
    });
});
