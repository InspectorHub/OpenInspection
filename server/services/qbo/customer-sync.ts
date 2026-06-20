import { eq, and } from 'drizzle-orm';
import { qboEntityMap } from '../../lib/db/schema/qbo';
import { logger } from '../../lib/logger';
import { type Constructor, type QBOServiceBase } from './api-base';

export function withCustomerSync<TBase extends Constructor<QBOServiceBase>>(Base: TBase) {
    return class extends Base {
        protected buildDisplayName(
            firstName: string,
            lastName: string,
            email: string | null,
            retry: number,
            contactId?: string,
        ): string {
            const base = `${firstName} ${lastName}`.trim() || 'Unknown';
            if (retry === 0) return base;
            if (retry === 1 && email) return `${base} (${email})`;
            return `${base} (${contactId ?? 'unknown'})`;
        }

        async upsertCustomer(
            tenantId: string,
            contact: {
                id: string;
                name: string;
                email?: string | null;
                phone?: string | null;
                agency?: string | null;
            },
        ): Promise<void> {
            const db = this.getDrizzle();
            const nameParts = contact.name.trim().split(' ');
            const firstName = nameParts[0] ?? '';
            const lastName = nameParts.slice(1).join(' ') || firstName;

            const buildPayload = (displayName: string) => ({
                DisplayName:      displayName,
                GivenName:        firstName,
                FamilyName:       lastName,
                CompanyName:      contact.agency ?? undefined,
                PrimaryEmailAddr: contact.email ? { Address: contact.email } : undefined,
                PrimaryPhone:     contact.phone ? { FreeFormNumber: contact.phone } : undefined,
            });

            const existing = await db.select().from(qboEntityMap).where(
                and(
                    eq(qboEntityMap.tenantId, tenantId),
                    eq(qboEntityMap.oiType, 'contact'),
                    eq(qboEntityMap.oiId, contact.id),
                ),
            ).get();

            try {
                if (existing) {
                    const displayName = this.buildDisplayName(firstName, lastName, contact.email ?? null, 0);
                    const updated = await this.apiCall<{ Customer: { Id: string; SyncToken: string } }>(
                        tenantId, 'PUT', 'customer',
                        { ...buildPayload(displayName), Id: existing.qboId, SyncToken: existing.qboSyncToken },
                    );
                    await db.update(qboEntityMap).set({
                        qboSyncToken: updated.Customer.SyncToken,
                        syncedAt:     Math.floor(Date.now() / 1000),
                    }).where(eq(qboEntityMap.id, existing.id));
                    return;
                }

                if (contact.email) {
                    const found = await this.qboQuery<{ QueryResponse: { Customer?: Array<{ Id: string; SyncToken: string; DisplayName: string }> } }>(
                        tenantId,
                        `SELECT * FROM Customer WHERE PrimaryEmailAddr = '${contact.email.replaceAll("'", "\\'")}' MAXRESULTS 5`,
                    );
                    const matches = found.QueryResponse.Customer ?? [];
                    const match = matches[0];
                    if (match) {
                        const now = Math.floor(Date.now() / 1000);
                        await db.insert(qboEntityMap).values({
                            id: crypto.randomUUID(), tenantId,
                            oiType: 'contact', oiId: contact.id,
                            qboType: 'Customer', qboId: match.Id,
                            qboSyncToken: match.SyncToken, syncedAt: now,
                        });
                        if (matches.length > 1) {
                            logger.info('QBO: multiple customers found by email — using first', {
                                tenantId, contactId: contact.id, count: matches.length,
                            });
                        }
                        await this.apiCall(tenantId, 'PUT', 'customer', {
                            ...buildPayload(match.DisplayName), Id: match.Id, SyncToken: match.SyncToken,
                        });
                        return;
                    }
                }

                for (let retry = 0; retry <= 2; retry++) {
                    const displayName = this.buildDisplayName(firstName, lastName, contact.email ?? null, retry, contact.id);
                    try {
                        const created = await this.apiCall<{ Customer: { Id: string; SyncToken: string } }>(
                            tenantId, 'POST', 'customer', buildPayload(displayName),
                        );
                        const now = Math.floor(Date.now() / 1000);
                        await db.insert(qboEntityMap).values({
                            id: crypto.randomUUID(), tenantId,
                            oiType: 'contact', oiId: contact.id,
                            qboType: 'Customer', qboId: created.Customer.Id,
                            qboSyncToken: created.Customer.SyncToken, syncedAt: now,
                        });
                        return;
                    } catch (err: unknown) {
                        const qboErr = err as { qboResponse?: { Fault?: { Error?: Array<{ code?: string }> } } };
                        // 6140 = "Duplicate Name Exists Error" — retry with a disambiguated DisplayName
                        const code = qboErr?.qboResponse?.Fault?.Error?.[0]?.code;
                        if (code === '6140' && retry < 2) continue;
                        throw err;
                    }
                }
            } catch (e) {
                logger.error('QBO upsertCustomer failed', { tenantId, contactId: contact.id }, e instanceof Error ? e : undefined);
                await this.logSyncError(tenantId, 'contact', contact.id, e);
            }
        }
    };
}
