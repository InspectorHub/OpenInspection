/**
 * The number a human uses for an invoice.
 *
 * There was no column. `invoice-sync.ts` read `invoice.invoiceNumber`, which no
 * write path set, and fell back to `invoice.id` sliced to 21 characters — so a
 * customer's QuickBooks showed `9ce7a7ba-c5e0-4678-86` as the document number.
 * Observed in a live Intuit sandbox, 2026-08-16. A UUID satisfies uniqueness,
 * so nothing ever failed and nothing complained.
 *
 * The allocation is one `UPDATE … RETURNING` and these specs are mostly about
 * why: D1 has no interactive transaction, so anything that reads a value and
 * writes it back can hand two concurrent invoices the same number — and
 * `uq_invoices_tenant_number` then refuses the second one in front of whoever
 * was raising it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import { allocateInvoiceNumber, formatInvoiceNumber } from '../../../server/services/invoice-number';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTHER = '00000000-0000-0000-0000-000000000002';
const T0 = new Date('2026-03-01T10:00:00Z');

let db: BetterSQLite3Database<typeof schema>;

beforeEach(async () => {
    const fix = createTestDb();
    db = fix.db;
    await setupSchema(fix.sqlite);
    for (const id of [TENANT, OTHER]) {
        await db.insert(schema.tenants).values({
            id, slug: `t-${id.slice(-4)}`, status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: T0,
        });
        await db.insert(schema.tenantConfigs).values({ tenantId: id, updatedAt: T0 } as never);
    }
});

const seqFor = async (tenantId: string) =>
    (await db.select({ n: schema.tenantConfigs.invoiceSeq })
        .from(schema.tenantConfigs)
        .where(eq(schema.tenantConfigs.tenantId, tenantId)).get())?.n;

describe('allocateInvoiceNumber', () => {
    it('starts at 1001, not at 1', async () => {
        // Starting at 1 tells a homebuyer they are this company's first-ever
        // customer. Jobber's `#1001` is the category convention and the reason
        // the counter's default is 1000 rather than 0.
        expect(await allocateInvoiceNumber(db as never, TENANT)).toBe(1001);
    });

    it('hands out a different number each time', async () => {
        const a = await allocateInvoiceNumber(db as never, TENANT);
        const b = await allocateInvoiceNumber(db as never, TENANT);
        const c = await allocateInvoiceNumber(db as never, TENANT);
        expect([a, b, c]).toEqual([1001, 1002, 1003]);
    });

    it('gives two tenants their own sequence, both starting at 1001', async () => {
        // The number is the tenant's, not the platform's. Two inspection
        // companies both having an invoice #1001 is correct; one of them
        // starting at #4,000 because another company has been busy is not.
        await allocateInvoiceNumber(db as never, TENANT);
        await allocateInvoiceNumber(db as never, TENANT);
        expect(await allocateInvoiceNumber(db as never, OTHER)).toBe(1001);
        expect(await seqFor(TENANT)).toBe(1002);
        expect(await seqFor(OTHER)).toBe(1001);
    });

    it('never returns the same number twice under concurrent allocation', async () => {
        // THE reason this is one statement. A read-then-write implementation
        // passes every test above and fails this one: both callers read 1000
        // and both return 1001, and the unique index then refuses the second
        // invoice at the point of sale.
        const results = await Promise.all(
            Array.from({ length: 25 }, () => allocateInvoiceNumber(db as never, TENANT)),
        );
        expect(new Set(results).size).toBe(25);
        expect(await seqFor(TENANT)).toBe(1025);
    });

    it('returns null for a tenant with no config row, rather than throwing', async () => {
        // A missing document number is cosmetic; refusing to raise the invoice
        // over one would make it commercial. The caller writes the row anyway.
        expect(await allocateInvoiceNumber(db as never, 'no-such-tenant')).toBeNull();
    });
});

describe('the database refuses a duplicate number', () => {
    it('rejects two invoices sharing one number within a tenant', async () => {
        // The last line of defence. Whatever the allocator does, two documents
        // a customer cannot tell apart must not both exist.
        const row = (id: string, number: number | null) => ({
            id, tenantId: TENANT, amountCents: 1000, lineItems: [],
            createdAt: T0, currency: 'USD', invoiceNumber: number,
        }) as never;

        await db.insert(schema.invoices).values(row('inv-1', 1001));
        await expect(db.insert(schema.invoices).values(row('inv-2', 1001)))
            .rejects.toThrow(/UNIQUE/i);
    });

    it('still allows many rows with NO number — the pre-column state', async () => {
        // The positive control. SQLite treats NULLs as distinct in a unique
        // index, which is what lets the column be added to a populated table at
        // all. Without this, "reject duplicates" could be satisfied by a
        // constraint that also blocks the migration itself.
        const row = (id: string) => ({
            id, tenantId: TENANT, amountCents: 1000, lineItems: [],
            createdAt: T0, currency: 'USD', invoiceNumber: null,
        }) as never;

        await db.insert(schema.invoices).values(row('inv-a'));
        await db.insert(schema.invoices).values(row('inv-b'));
        expect(await db.select().from(schema.invoices).all()).toHaveLength(2);
    });
});

describe('formatInvoiceNumber', () => {
    it('renders the number with a hash', () => {
        expect(formatInvoiceNumber(1042, 'ignored')).toBe('#1042');
    });

    it('falls back to a short id for a row written before the column existed', () => {
        // Not an empty cell: blank reads as a bug to whoever is looking at it.
        expect(formatInvoiceNumber(null, '9ce7a7ba-c5e0-4678-865c')).toBe('9ce7a7ba');
    });
});
