import { eq, and, inArray, isNull } from 'drizzle-orm';
import { qboConnections, qboEntityMap, qboSyncErrors } from '../../lib/db/schema/qbo';
import { invoices } from '../../lib/db/schema/invoice';
import { orderPayments } from '../../lib/db/schema/order-payment';
import { encryptToken } from '../../lib/qbo-crypto';
import { Errors } from '../../lib/errors';
import { QBO_PAYMENT_DISCREPANCY, decodePaymentDiscrepancy } from '../../lib/qbo-discrepancy';
import {
    ACCESS_TOKEN_TTL_SEC,
    type Constructor,
    type QBOConnectionStatus,
    type QBOPaymentDiscrepancy,
    type QBOServiceBase,
} from './api-base';
import { withToken } from './token';

export function withConnection<TBase extends Constructor<QBOServiceBase>>(Base: TBase) {
    return class extends withToken(Base) {
        async saveConnection(input: {
            tenantId: string;
            realmId: string;
            companyName: string | null;
            accessToken: string;
            refreshToken: string;
            refreshTokenExpiresIn: number;
        }): Promise<void> {
            const db = this.getDrizzle();
            const nowMs = Date.now();
            const [encAccess, encRefresh] = await Promise.all([
                encryptToken(input.accessToken, this.jwtSecret),
                encryptToken(input.refreshToken, this.jwtSecret),
            ]);
            const baseValues = {
                realmId:               input.realmId,
                companyName:           input.companyName,
                accessToken:           encAccess,
                refreshToken:          encRefresh,
                tokenExpiresAt:        new Date(nowMs + ACCESS_TOKEN_TTL_SEC * 1000),
                refreshTokenExpiresAt: new Date(nowMs + input.refreshTokenExpiresIn * 1000),
            };
            await db.insert(qboConnections).values({
                tenantId:      input.tenantId,
                syncEnabled:   true,
                defaultItemId: '1',
                createdAt:     new Date(nowMs),
                ...baseValues,
            }).onConflictDoUpdate({
                target: qboConnections.tenantId,
                set:    baseValues,
            });
        }

        async setSyncEnabled(tenantId: string): Promise<boolean | null> {
            const db = this.getDrizzle();
            const row = await db.select().from(qboConnections).where(eq(qboConnections.tenantId, tenantId)).get();
            if (!row) return null;
            const newEnabled = !row.syncEnabled;
            await db.update(qboConnections).set({ syncEnabled: newEnabled })
                .where(eq(qboConnections.tenantId, tenantId));
            return newEnabled;
        }

        async resolveError(tenantId: string, errorId: string): Promise<void> {
            const db = this.getDrizzle();
            // `updatedAt` is what dates the response; `createdAt` only dates the
            // failure. Without the stamp — which clearPaymentDiscrepancy already
            // writes on the same table — "when was this dealt with" has no answer.
            await db.update(qboSyncErrors).set({ resolved: true, updatedAt: new Date() })
                .where(and(eq(qboSyncErrors.id, errorId), eq(qboSyncErrors.tenantId, tenantId)));
        }

        async getConnectionStatus(tenantId: string): Promise<QBOConnectionStatus | null> {
            const db = this.getDrizzle();
            const row = await db.select().from(qboConnections)
                .where(eq(qboConnections.tenantId, tenantId)).get();
            if (!row) return null;
            const errorRows = await db.select().from(qboSyncErrors)
                .where(and(eq(qboSyncErrors.tenantId, tenantId), eq(qboSyncErrors.resolved, false))).all();

            // Explicit projection, not select(): the invoice join is only here
            // for the currency each pair of figures should be read in, and a
            // wide invoice row would run at D1's 100-column result cap.
            const discrepancyRows = errorRows.filter(r => r.errorCode === QBO_PAYMENT_DISCREPANCY);
            const currencies = discrepancyRows.length === 0 ? [] : await db
                .select({ id: invoices.id, currency: invoices.currency })
                .from(invoices)
                .where(and(
                    eq(invoices.tenantId, tenantId),
                    inArray(invoices.id, discrepancyRows.map(r => r.oiId)),
                )).all();
            const currencyOf = new Map(currencies.map(c => [c.id, c.currency]));

            const paymentDiscrepancies: QBOPaymentDiscrepancy[] = [];
            for (const row of discrepancyRows) {
                const figures = decodePaymentDiscrepancy(row.errorMsg);
                // A row this codec did not write has no two figures to show, and
                // a half-rendered discrepancy is worse than none.
                if (!figures) continue;
                paymentDiscrepancies.push({
                    id:          row.id,
                    invoiceId:   row.oiId,
                    currency:    currencyOf.get(row.oiId) ?? 'USD',
                    ledgerCents: figures.ledgerCents,
                    qboCents:    figures.qboCents,
                });
            }

            // Money we hold that predates any invoice. Never pushed: an
            // unapplied deposit needs a liability account in the tenant's own
            // chart of accounts, which is their accountant's call, not ours.
            const heldDeposits = await db.select({ id: orderPayments.id })
                .from(orderPayments)
                .where(and(
                    eq(orderPayments.tenantId, tenantId),
                    isNull(orderPayments.invoiceId),
                )).all();

            return {
                realmId:               row.realmId,
                companyName:           row.companyName,
                // QBOConnectionStatus keeps the epoch-SECONDS contract the
                // settings UI already reads (timeSince/expiryWarning in
                // app/routes/settings-integrations-qbo.tsx), independent of
                // the column's own Date storage type.
                lastSyncAt:            row.lastSyncAt ? Math.floor(row.lastSyncAt.getTime() / 1000) : null,
                syncEnabled:           row.syncEnabled,
                // Failed pushes only. A discrepancy is not a failure — nothing
                // went wrong on the wire — and filing it under "sync errors"
                // would bury the one thing on this page that needs a human.
                openErrors:            errorRows.length - discrepancyRows.length,
                paymentDiscrepancies,
                heldDepositCount:      heldDeposits.length,
                refreshTokenExpiresAt: Math.floor(row.refreshTokenExpiresAt.getTime() / 1000),
            };
        }

        async disconnect(tenantId: string): Promise<void> {
            // Tell Intuit first, then forget. The order matters only for the
            // token: revoking needs the credential this is about to delete.
            await this.revokeToken(tenantId);
            // One routine, shared with the path where Intuit refuses the grant.
            // These two used to delete different sets of rows, and the drift was
            // invisible because each looked complete on its own.
            await this.retireConnection(tenantId);
        }

        async linkExistingCustomer(tenantId: string, contactId: string, qboCustomerId: string): Promise<void> {
            const db = this.getDrizzle();

            // The reverse unique index (tenant, qboType, qboId) is NOT the
            // conflict target below, so a second contact pointed at the same
            // customer used to surface as a raw `UNIQUE constraint failed`.
            // Whoever picked the customer reads this; it has to name the holder.
            const takenBy = await db.select().from(qboEntityMap).where(and(
                eq(qboEntityMap.tenantId, tenantId),
                eq(qboEntityMap.qboType, 'Customer'),
                eq(qboEntityMap.qboId, qboCustomerId),
            )).get();
            if (takenBy && takenBy.oiId !== contactId) {
                // 409, not 500: the caller picked a customer someone else holds,
                // which is a decision to revisit rather than a fault to report.
                // A readable message that still arrives as a server error tells
                // the operator the product broke when it did not.
                throw Errors.Conflict(
                    `QuickBooks customer ${qboCustomerId} is already linked to contact ${takenBy.oiId}`,
                );
            }

            // Ask QuickBooks where this customer currently stands rather than
            // assuming. '0' is only true of a customer never edited, and on a
            // re-point the row kept the PREVIOUS customer's counter — either way
            // the next update sends a token for the wrong entity and 400s.
            //
            // This makes linking able to fail on an API error, which it could
            // not before. That is the intended trade: a mapping carrying an
            // invented token fails later instead, on an invoice push, where
            // nothing points back at the link that caused it.
            const fetched = await this.apiCall<{ Customer: { Id: string; SyncToken: string } }>(
                tenantId, 'GET', `customer/${qboCustomerId}`,
            );

            const now = new Date();
            await db.insert(qboEntityMap).values({
                id:           crypto.randomUUID(),
                tenantId,
                oiType:       'contact',
                oiId:         contactId,
                qboType:      'Customer',
                qboId:        qboCustomerId,
                qboSyncToken: fetched.Customer.SyncToken,
                syncedAt:     now,
            }).onConflictDoUpdate({
                target: [qboEntityMap.tenantId, qboEntityMap.oiType, qboEntityMap.oiId],
                set:    {
                    qboId:        qboCustomerId,
                    qboSyncToken: fetched.Customer.SyncToken,
                    syncedAt:     now,
                },
            });
        }
    };
}
