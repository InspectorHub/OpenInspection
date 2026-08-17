/**
 * The open rows a human has to look at, and the only code that writes them.
 *
 * `qbo_sync_errors` is not only an error log. It carries three different kinds
 * of thing under `error_code` — a push that failed, two figures that disagree,
 * and a document QuickBooks zeroed — because each is "something a person has to
 * decide about" and the table already had a tenant scope, a resolved flag and a
 * settings surface. Keeping the writers together is what makes the identity of
 * an open row (tenant, oi_type, oi_id, error_code) checkable in one place.
 *
 * Free functions over a drizzle handle rather than methods, following
 * `inbound-reconcile.ts`: the QBO service is a stack of mixins, and every
 * behaviour that needs no HTTP has been pulled out of it so the class stays the
 * part that talks to Intuit.
 */
import { eq, and } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { qboSyncErrors } from '../../lib/db/schema/qbo';
import {
    QBO_PAYMENT_DISCREPANCY,
    QBO_VOIDED_IN_QBO,
    encodePaymentDiscrepancy,
} from '../../lib/qbo-discrepancy';

/**
 * One open row per (entity, kind). `errorCode` is part of the identity: a
 * failed push and a payment discrepancy on the same invoice are two different
 * things to look at, and collapsing them would overwrite one with the other.
 *
 * Re-detection REFRESHES the existing row and bumps `retries` rather than
 * appending — a sweep that runs hourly would otherwise turn one unresolved
 * problem into a hundred rows describing it.
 */
export async function upsertSyncFlag(
    db: DrizzleD1Database,
    tenantId: string, oiType: string, oiId: string, errorCode: string, errorMsg: string,
): Promise<void> {
    const now = new Date();
    const existing = await db.select().from(qboSyncErrors)
        .where(and(
            eq(qboSyncErrors.tenantId, tenantId),
            eq(qboSyncErrors.oiType, oiType),
            eq(qboSyncErrors.oiId, oiId),
            eq(qboSyncErrors.errorCode, errorCode),
            eq(qboSyncErrors.resolved, false),
        )).get();

    if (existing) {
        await db.update(qboSyncErrors).set({
            retries:   existing.retries + 1,
            errorMsg,
            updatedAt: now,
        }).where(and(
            eq(qboSyncErrors.tenantId, tenantId),
            eq(qboSyncErrors.id, existing.id),
        ));
        return;
    }

    await db.insert(qboSyncErrors).values({
        id:        crypto.randomUUID(),
        tenantId,
        oiType,
        oiId,
        errorCode,
        errorMsg,
        retries:   0,
        resolved:  false,
        createdAt: now,
        updatedAt: now,
    });
}

/**
 * QuickBooks and our ledger disagree about what was collected. Recorded, not
 * corrected: an adjusting entry would manufacture money movement nobody
 * performed, and a human reconciles money. Re-detecting the same disagreement
 * refreshes the figures instead of stacking rows.
 */
export async function recordPaymentDiscrepancy(
    db: DrizzleD1Database,
    tenantId: string, invoiceId: string, ledgerCents: number, qboCents: number,
): Promise<void> {
    await upsertSyncFlag(
        db, tenantId, 'invoice', invoiceId, QBO_PAYMENT_DISCREPANCY,
        encodePaymentDiscrepancy({ ledgerCents, qboCents }),
    );
}

/**
 * QuickBooks reports the document as worth nothing — voided on their side.
 *
 * Recorded, never applied. Mirroring a void inbound would reset this
 * inspection's payment gate and retract a published report on the strength of a
 * poll; voiding is a decision, not a reading. The sweep's job here is to make
 * sure a human finds out.
 */
export async function noteVoidedInQuickBooks(
    db: DrizzleD1Database, tenantId: string, invoiceId: string,
): Promise<void> {
    await upsertSyncFlag(
        db, tenantId, 'invoice', invoiceId, QBO_VOIDED_IN_QBO,
        'Voided in QuickBooks. OpenInspection left this invoice unchanged — '
        + 'void it here too if that was intended.',
    );
}

/** The two sides agree again — whoever reconciled it does not have to also tick it off. */
export async function clearPaymentDiscrepancy(
    db: DrizzleD1Database, tenantId: string, invoiceId: string,
): Promise<void> {
    await db.update(qboSyncErrors).set({ resolved: true, updatedAt: new Date() })
        .where(and(
            eq(qboSyncErrors.tenantId, tenantId),
            eq(qboSyncErrors.oiType, 'invoice'),
            eq(qboSyncErrors.oiId, invoiceId),
            eq(qboSyncErrors.errorCode, QBO_PAYMENT_DISCREPANCY),
            eq(qboSyncErrors.resolved, false),
        ));
}
