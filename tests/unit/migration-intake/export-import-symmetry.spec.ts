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
import { createTestDb, setupSchema } from '../db';
import { toD1Binding } from '../helpers/d1-binding';
import { DataService } from '../../../server/services/data.service';
import { contacts, tenants } from '../../../server/lib/db/schema';
import { CONTACT_EXCHANGE } from '../../../server/lib/data-exchange/contacts';
import { exportHeaders } from '../../../server/lib/data-exchange/types';
import { parseCsvTable } from '../../../server/lib/migration-intake/csv';

const TENANT = 'tenant-symmetry';

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

let svc: DataService;
beforeEach(async () => {
    const fix = createTestDb();
    await setupSchema(fix.sqlite);
    await fix.db.insert(tenants).values({
        id: TENANT, slug: 'symmetry', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await fix.db.insert(contacts).values(SEED);
    svc = new DataService(toD1Binding(fix.sqlite));
});

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
