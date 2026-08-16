import { eq, and } from 'drizzle-orm';
import { qboEntityMap } from '../../lib/db/schema/qbo';
import { logger } from '../../lib/logger';
import type { Constructor, QBOServiceBase } from './api-base';
import { describeQboError } from './api-base';

export function withCustomerSync<TBase extends Constructor<QBOServiceBase>>(Base: TBase) {
    return class extends Base {
        public buildDisplayName(
            firstName: string,
            lastName: string,
            email: string | null,
            retry: number,
            contactId?: string,
        ): string {
            const base = `${firstName} ${lastName}`.trim() || 'Unknown';
            if (retry === 0) return base;
            if (retry === 1 && email) return `${base} (${email})`;
            const id = contactId ?? 'unknown';
            // Without an email, rungs 2 and 3 used to be the same string, so the
            // third attempt re-collided on 6140 and burned an API call for
            // nothing. Each rung has to differ from the one below it or it is
            // not a rung.
            //
            // The TAIL, not the head: a rung also has to differ between two
            // contacts who share a name, which is the collision it exists to
            // escape. Contact ids are randomUUID() today and either end would
            // do, but an id that ever carries a fixed prefix would make every
            // head-slice identical and quietly turn this rung back into the
            // duplicate it is here to avoid.
            if (retry === 1) return `${base} (${id.slice(-8)})`;
            return `${base} (${id})`;
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
                        tenantId, 'POST', 'customer',
                        { ...buildPayload(displayName), Id: existing.qboId, SyncToken: existing.qboSyncToken },
                    );
                    await db.update(qboEntityMap).set({
                        qboSyncToken: updated.Customer.SyncToken,
                        syncedAt:     new Date(),
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
                        // PUT first: the write is what settles the SyncToken.
                        // QuickBooks increments it on the write, so persisting
                        // the pre-update value we were handed by the query would
                        // make the map stale the moment it is created — and this
                        // path has no stale-token refetch to recover with.
                        const linked = await this.apiCall<{ Customer: { Id: string; SyncToken: string } }>(
                            tenantId, 'POST', 'customer',
                            { ...buildPayload(match.DisplayName), Id: match.Id, SyncToken: match.SyncToken },
                        );
                        await db.insert(qboEntityMap).values({
                            id: crypto.randomUUID(), tenantId,
                            oiType: 'contact', oiId: contact.id,
                            qboType: 'Customer', qboId: linked.Customer.Id,
                            qboSyncToken: linked.Customer.SyncToken, syncedAt: new Date(),
                        });
                        if (matches.length > 1) {
                            logger.info('QBO: multiple customers found by email — using first', {
                                tenantId, contactId: contact.id, count: matches.length,
                            });
                        }
                        return;
                    }
                }

                for (let retry = 0; retry <= 2; retry++) {
                    const displayName = this.buildDisplayName(firstName, lastName, contact.email ?? null, retry, contact.id);
                    try {
                        const created = await this.apiCall<{ Customer: { Id: string; SyncToken: string } }>(
                            tenantId, 'POST', 'customer', buildPayload(displayName),
                        );
                        const now = new Date();
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
                logger.error('QBO upsertCustomer failed', { tenantId, contactId: contact.id, qbo: describeQboError(e) }, e instanceof Error ? e : undefined);
                await this.logSyncError(tenantId, 'contact', contact.id, e);
            }
        }
    };
}
