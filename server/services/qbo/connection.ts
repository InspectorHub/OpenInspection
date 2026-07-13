import { eq, and } from 'drizzle-orm';
import { qboConnections, qboEntityMap, qboSyncErrors } from '../../lib/db/schema/qbo';
import { encryptToken } from '../../lib/qbo-crypto';
import {
    ACCESS_TOKEN_TTL_SEC,
    type Constructor,
    type QBOConnectionStatus,
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
            await db.update(qboSyncErrors).set({ resolved: true })
                .where(and(eq(qboSyncErrors.id, errorId), eq(qboSyncErrors.tenantId, tenantId)));
        }

        async getConnectionStatus(tenantId: string): Promise<QBOConnectionStatus | null> {
            const db = this.getDrizzle();
            const row = await db.select().from(qboConnections)
                .where(eq(qboConnections.tenantId, tenantId)).get();
            if (!row) return null;
            const errorRows = await db.select().from(qboSyncErrors)
                .where(and(eq(qboSyncErrors.tenantId, tenantId), eq(qboSyncErrors.resolved, false))).all();
            return {
                realmId:               row.realmId,
                companyName:           row.companyName,
                // QBOConnectionStatus keeps the epoch-SECONDS contract the
                // settings UI already reads (timeSince/expiryWarning in
                // app/routes/settings-integrations-qbo.tsx), independent of
                // the column's own Date storage type.
                lastSyncAt:            row.lastSyncAt ? Math.floor(row.lastSyncAt.getTime() / 1000) : null,
                syncEnabled:           row.syncEnabled,
                openErrors:            errorRows.length,
                refreshTokenExpiresAt: Math.floor(row.refreshTokenExpiresAt.getTime() / 1000),
            };
        }

        async disconnect(tenantId: string): Promise<void> {
            await this.revokeToken(tenantId);
            const db = this.getDrizzle();
            await db.delete(qboEntityMap).where(eq(qboEntityMap.tenantId, tenantId));
            await db.delete(qboConnections).where(eq(qboConnections.tenantId, tenantId));
        }

        async linkExistingCustomer(tenantId: string, contactId: string, qboCustomerId: string): Promise<void> {
            const db = this.getDrizzle();
            const now = new Date();
            await db.insert(qboEntityMap).values({
                id:           crypto.randomUUID(),
                tenantId,
                oiType:       'contact',
                oiId:         contactId,
                qboType:      'Customer',
                qboId:        qboCustomerId,
                qboSyncToken: '0',
                syncedAt:     now,
            }).onConflictDoUpdate({
                target: [qboEntityMap.tenantId, qboEntityMap.oiType, qboEntityMap.oiId],
                set:    { qboId: qboCustomerId, syncedAt: now },
            });
        }
    };
}
