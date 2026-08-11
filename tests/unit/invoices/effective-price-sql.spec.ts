/**
 * The P-4 authority chain exists twice — once as a pure function for a single
 * loaded inspection (server/lib/effective-price.ts), once as SQL so aggregates
 * can group and sum without loading every row (server/lib/effective-price.sql.ts).
 *
 * Two implementations of one money rule is exactly the "must stay in sync with X"
 * coupling CLAUDE.md says to make executable rather than write in a comment. This
 * is that executable part: every fixture below is scored by BOTH and the two must
 * agree. Change one tier in one place and this fails.
 *
 * The last test is the specific regression. Metrics summed `inspections.price`
 * alone — tier 3, the denormalized cache — and reported $0 total revenue for a
 * tenant whose invoices said otherwise (IA-132). So it is not enough that the two
 * implementations agree; the SQL must also visibly disagree with the naive
 * `sum(price_cents)` that used to be there, or the fixtures aren't exercising the
 * bug.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { createTestDb, setupSchema } from '../db';
import { inspections, inspectionServices, services } from '../../../server/lib/db/schema';
import { invoices } from '../../../server/lib/db/schema/invoice';
import { tenants } from '../../../server/lib/db/schema';
import { effectivePriceCentsSql } from '../../../server/lib/effective-price.sql';
import { getEffectivePriceCents } from '../../../server/lib/effective-price';

const T = 'tnt-1';
const NOW = 1_700_000_000_000;

/**
 * Each case states what the DB holds and what the chain should therefore say.
 * `expected` is asserted against BOTH implementations, so it is the rule itself
 * rather than either implementation's behavior.
 */
const CASES = [
    {
        id: 'i-invoice-wins',
        why: 'invoice present — authoritative over both a service bundle and the cache',
        priceCents: 100,
        invoice: { amountCents: 45_000, voidedAt: null },
        services: [{ priceSnapshot: 999, priceOverride: null }],
        expected: 45_000,
    },
    {
        id: 'i-invoice-zero',
        why: 'a ZERO invoice is still an invoice — it must beat a non-zero cache',
        priceCents: 99_900,
        invoice: { amountCents: 0, voidedAt: null },
        services: [],
        expected: 0,
    },
    {
        id: 'i-invoice-voided',
        why: 'a voided invoice is not an invoice — fall through to the service bundle',
        priceCents: 100,
        invoice: { amountCents: 45_000, voidedAt: NOW },
        services: [{ priceSnapshot: 20_000, priceOverride: null }, { priceSnapshot: 5_000, priceOverride: null }],
        expected: 25_000,
    },
    {
        id: 'i-service-override',
        why: 'per-line override beats the line snapshot',
        priceCents: 100,
        invoice: null,
        services: [{ priceSnapshot: 20_000, priceOverride: 12_500 }, { priceSnapshot: 5_000, priceOverride: null }],
        expected: 17_500,
    },
    {
        id: 'i-no-services-falls-through',
        why: 'NO service rows means "not attached", not "free" — use the cache',
        priceCents: 33_300,
        invoice: null,
        services: [],
        expected: 33_300,
    },
    {
        id: 'i-zero-priced-bundle',
        why: 'service rows that really do sum to zero ARE zero — distinct from having none',
        priceCents: 33_300,
        invoice: null,
        services: [{ priceSnapshot: 0, priceOverride: null }],
        expected: 0,
    },
    {
        id: 'i-nothing',
        why: 'no invoice, no services, cache is 0 — zero',
        priceCents: 0,
        invoice: null,
        services: [],
        expected: 0,
    },
] as const;

let handle: ReturnType<typeof createTestDb>;

beforeAll(async () => {
    handle = createTestDb();
    await setupSchema(handle.sqlite);
    const { db } = handle;

    await db.insert(tenants).values({ id: T, slug: 'fixture-co', createdAt: new Date(NOW) } as never);
    // inspection_services.service_id is NOT NULL — one catalog row for every line to point at.
    await db.insert(services).values({ id: 'svc-catalog', tenantId: T, name: 'Fixture Service', price: 0, createdAt: new Date(NOW) } as never);

    for (const c of CASES) {
        await db.insert(inspections).values({
            id: c.id,
            tenantId: T,
            propertyAddress: c.id,
            date: '2026-07-01',
            price: c.priceCents,
            createdAt: new Date(NOW),
        } as never);

        if (c.invoice) {
            await db.insert(invoices).values({
                id: `inv-${c.id}`,
                tenantId: T,
                inspectionId: c.id,
                amountCents: c.invoice.amountCents,
                voidedAt: c.invoice.voidedAt === null ? null : new Date(c.invoice.voidedAt),
                createdAt: new Date(NOW),
            } as never);
        }

        for (const [i, s] of c.services.entries()) {
            await db.insert(inspectionServices).values({
                id: `svc-${c.id}-${i}`,
                tenantId: T,
                inspectionId: c.id,
                serviceId: 'svc-catalog',
                nameSnapshot: 'Fixture Service',
                priceSnapshot: s.priceSnapshot,
                priceOverride: s.priceOverride,
            } as never);
        }
    }
});

afterAll(() => handle?.sqlite.close());

describe('P-4 effective price — SQL and pure helper must agree', () => {
    it.each(CASES.map((c) => [c.id, c.why] as const))('%s — %s', async (id) => {
        const c = CASES.find((x) => x.id === id)!;

        const [row] = await handle.db
            .select({ cents: effectivePriceCentsSql })
            .from(inspections)
            .where(eq(inspections.id, id));

        const fromSql = Number(row.cents);
        const fromHelper = getEffectivePriceCents({
            invoiceAmountCents: c.invoice && c.invoice.voidedAt === null ? c.invoice.amountCents : null,
            serviceLines: [...c.services],
            inspectionPriceCents: c.priceCents,
        });

        expect(fromSql).toBe(c.expected);
        expect(fromHelper).toBe(c.expected);
    });
});

describe('IA-132 — the aggregate must not collapse to the tier-3 cache', () => {
    it('totals the authority chain, not sum(price_cents)', async () => {
        const [chain] = await handle.db
            .select({ total: sql<number>`sum(${effectivePriceCentsSql})` })
            .from(inspections)
            .where(eq(inspections.tenantId, T));

        const [cacheOnly] = await handle.db
            .select({ total: sql<number>`sum(${inspections.price})` })
            .from(inspections)
            .where(eq(inspections.tenantId, T));

        const expected = CASES.reduce((s, c) => s + c.expected, 0);
        expect(Number(chain.total)).toBe(expected);

        // The shape of the bug: the old query was not merely imprecise, it
        // reported a different number. If these ever coincide the fixtures have
        // stopped covering the case that broke Metrics.
        expect(Number(cacheOnly.total)).not.toBe(Number(chain.total));
    });
});
