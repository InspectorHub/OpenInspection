/**
 * What the inspection hub reads to say "Deposit paid" before any invoice exists.
 *
 * Display only: the summary must report the net held amount and when it landed,
 * must be tenant-scoped, must go quiet once a refund or an invoice takes the
 * money off the order, and must never change anything.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import { asAnyDb } from '../helpers/test-db';
import { recordPayment, getHeldDepositSummary } from '../../../server/services/payment-ledger.service';

const TENANT = '00000000-0000-0000-0000-0000000000b1';
const OTHER = '00000000-0000-0000-0000-0000000000b2';
const INSPECTION = 'insp-0000-0000-0000-0000000000b1';

let db: BetterSQLite3Database<typeof schema>;

beforeEach(async () => {
    const fixture = createTestDb();
    db = fixture.db;
    await setupSchema(fixture.sqlite);
    for (const [id, slug] of [[TENANT, 'acme'], [OTHER, 'other']] as const) {
        await db.insert(schema.tenants).values({
            id, slug, status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await db.insert(schema.tenantConfigs).values({ tenantId: id, updatedAt: new Date() });
    }
    await db.insert(schema.inspections).values({
        id: INSPECTION, tenantId: TENANT, propertyAddress: '1 Oak St',
        date: '2026-07-17', createdAt: new Date(), depositRequiredCents: 45000,
    });
});

const pay = (kind: 'deposit' | 'refund', amountCents: number, providerRef: string, occurredAt: Date) =>
    recordPayment(asAnyDb(db), TENANT, {
        inspectionId: INSPECTION, invoiceId: null, kind, amountCents,
        method: 'card', provider: 'stripe', providerRef, occurredAt,
    });

describe('getHeldDepositSummary', () => {
    it('is null when nothing is held', async () => {
        expect(await getHeldDepositSummary(asAnyDb(db), TENANT, INSPECTION)).toBeNull();
    });

    it('reports the held amount and the date it landed, and leaves the order unpaid', async () => {
        const when = new Date('2026-11-05T15:00:00Z');
        await pay('deposit', 45000, 'pi_a', when);

        expect(await getHeldDepositSummary(asAnyDb(db), TENANT, INSPECTION)).toEqual({ cents: 45000, paidAt: when });

        const insp = await db.select().from(schema.inspections).where(eq(schema.inspections.id, INSPECTION)).get();
        expect(insp!.paymentStatus).toBe('unpaid');
    });

    it('is net of a refund, and null when the refund takes it all back', async () => {
        await pay('deposit', 45000, 'pi_a', new Date('2026-11-05T15:00:00Z'));
        await pay('refund', 5000, 'rf_a', new Date('2026-11-06T15:00:00Z'));
        expect(await getHeldDepositSummary(asAnyDb(db), TENANT, INSPECTION)).toEqual({
            cents: 40000, paidAt: new Date('2026-11-05T15:00:00Z'),
        });
        await pay('refund', 40000, 'rf_b', new Date('2026-11-07T15:00:00Z'));
        expect(await getHeldDepositSummary(asAnyDb(db), TENANT, INSPECTION)).toBeNull();
    });

    it("never reads another tenant's rows", async () => {
        await pay('deposit', 45000, 'pi_a', new Date('2026-11-05T15:00:00Z'));
        expect(await getHeldDepositSummary(asAnyDb(db), OTHER, INSPECTION)).toBeNull();
    });
});
