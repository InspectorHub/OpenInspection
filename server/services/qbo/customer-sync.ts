import { eq, and } from 'drizzle-orm';
import { qboEntityMap } from '../../lib/db/schema/qbo';
import { logger } from '../../lib/logger';
import type { Constructor, QBOServiceBase } from './api-base';
import { describeQboError } from './api-base';
import { splitName, buildCustomerPayload, sanitizeDisplayName } from './customer-payload';

/**
 * The ValidationFault codes QuickBooks uses to say "that DisplayName is taken".
 *
 * `6240` is the one a live company actually returns — captured from the sandbox
 * on 2026-08-16 by POSTing a name that already existed:
 *
 *     { Message: 'Duplicate Name Exists Error',
 *       Detail:  'The name supplied already exists. : null',
 *       code:    '6240' }
 *
 * This set used to hold only `6140`, which no response in that capture carried,
 * so the disambiguation ladder below never once ran against the real API: the
 * first collision threw, the contact got a `qbo_sync_errors` row, and no second
 * rung was ever attempted. The unit tests did not catch it because they built
 * their own fault objects from the same wrong number the implementation read.
 *
 * `6140` stays because it costs nothing and this file cannot prove no Intuit
 * surface emits it; a name collision is a name collision under either number.
 * Anything ADDED here needs a captured response behind it, not a doc page.
 */
const DUPLICATE_NAME_FAULT_CODES: ReadonlySet<string> = new Set(['6240', '6140']);

export function withCustomerSync<TBase extends Constructor<QBOServiceBase>>(Base: TBase) {
    return class extends Base {
        public buildDisplayName(
            firstName: string,
            lastName: string,
            email: string | null,
            retry: number,
            contactId?: string,
        ): string {
            // Sanitised at the BASE, so every rung inherits it — an email and a
            // UUID cannot carry a colon, but the person's name can, and a rung
            // built on an unsanitised base would carry it too.
            const base = sanitizeDisplayName(`${firstName} ${lastName}`) || 'Unknown';
            if (retry === 0) return base;
            if (retry === 1 && email) return `${base} (${email})`;
            const id = contactId ?? 'unknown';
            // Without an email, rungs 2 and 3 used to be the same string, so the
            // third attempt re-collided on the same duplicate-name fault and
            // burned an API call for nothing. Each rung has to differ from the
            // one below it or it is not a rung.
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
            const { firstName, lastName } = splitName(contact.name);

            const buildPayload = (displayName: string) =>
                buildCustomerPayload(displayName, firstName, lastName, contact);

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
                        // Retry with a disambiguated DisplayName when QuickBooks
                        // says the name is taken. EVERY reported error is checked,
                        // not just the first: one ValidationFault can carry several
                        // and the duplicate need not lead.
                        const isDuplicateName = (qboErr?.qboResponse?.Fault?.Error ?? []).some(
                            (e) => e?.code !== undefined && DUPLICATE_NAME_FAULT_CODES.has(String(e.code)),
                        );
                        if (isDuplicateName && retry < 2) continue;
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
