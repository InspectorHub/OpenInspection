import { eq, and, isNull } from 'drizzle-orm';
import { contacts } from '../../lib/db/schema/contact';
import { qboEntityMap, qboSyncErrors } from '../../lib/db/schema/qbo';
import { writeAuditRow } from '../../lib/audit';
import { isUniqueViolation } from '../../lib/db/unique-violation';
import { Errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import type { Constructor, QBOServiceBase } from './api-base';

type Db = ReturnType<QBOServiceBase['getDrizzle']>;

export interface LinkResult {
    qboCustomerId: string;
    displayName: string;
    /** The customer this contact pointed at before, when that was a different one. */
    replacedQboCustomerId: string | null;
    resolvedErrorCount: number;
}

export interface ContactLink {
    linked: boolean;
    qboCustomerId: string | null;
    displayName: string | null;
    openErrorCount: number;
}

/**
 * A contact id arrives from a request, so it is only ever believed once the row
 * is found under THIS company. A foreign id is "not found" -- the same answer
 * as one that never existed -- so the response cannot confirm that another
 * workspace has such a contact. `live` also refuses an archived contact: nothing
 * new should be pointed at a row the product no longer shows.
 */
async function requireContact(db: Db, tenantId: string, contactId: string, live: boolean) {
    const contact = await db.select({ id: contacts.id }).from(contacts)
        .where(and(
            eq(contacts.id, contactId),
            eq(contacts.tenantId, tenantId),
            ...(live ? [isNull(contacts.archivedAt)] : []),
        )).get();
    if (!contact) throw Errors.NotFound('Contact not found');
}

/** The 409 for a customer another contact already holds -- naming that contact. */
async function customerTaken(db: Db, tenantId: string, holderContactId: string) {
    const holder = await db.select({ name: contacts.name, archivedAt: contacts.archivedAt }).from(contacts)
        .where(and(eq(contacts.id, holderContactId), eq(contacts.tenantId, tenantId))).get();
    const holderName = holder?.name ?? null;
    return Errors.Conflict(
        `That QuickBooks customer is already matched to ${holderName ?? 'another contact'}`,
        // `holderArchived` lets the caller say where the match can be undone: an
        // archived contact is not listed, so its detail page is the only way in.
        { reason: 'qbo_customer_taken', holderContactId, holderName, holderArchived: holder?.archivedAt != null },
    );
}

const contactMapping = (tenantId: string, contactId: string) => and(
    eq(qboEntityMap.tenantId, tenantId),
    eq(qboEntityMap.oiType, 'contact'),
    eq(qboEntityMap.oiId, contactId),
);

const openContactErrors = (tenantId: string, contactId: string) => and(
    eq(qboSyncErrors.tenantId, tenantId),
    eq(qboSyncErrors.oiType, 'contact'),
    eq(qboSyncErrors.oiId, contactId),
    eq(qboSyncErrors.resolved, false),
);

// The link already happened. A failure to RECORD it must not turn the
// operator's successful action into an error they would retry -- hence the catch.
async function auditLinked(
    db: D1Database, tenantId: string, actorUserId: string, contactId: string,
    qboCustomerId: string, replacedQboCustomerId: string | null,
): Promise<void> {
    try {
        await writeAuditRow({
            db, tenantId, userId: actorUserId, action: 'qbo.customer.linked',
            entityType: 'contact', entityId: contactId,
            metadata: { contactId, qboCustomerId, replacedQboCustomerId },
        });
    } catch (err) {
        logger.error('QBO customer link audit write failed', { tenantId, contactId }, err instanceof Error ? err : undefined);
    }
}

async function auditUnlinked(
    db: D1Database, tenantId: string, actorUserId: string, contactId: string, qboCustomerId: string,
): Promise<void> {
    try {
        await writeAuditRow({
            db, tenantId, userId: actorUserId, action: 'qbo.customer.unlinked',
            entityType: 'contact', entityId: contactId,
            metadata: { contactId, qboCustomerId },
        });
    } catch (err) {
        logger.error('QBO customer unlink audit write failed', { tenantId, contactId }, err instanceof Error ? err : undefined);
    }
}

/**
 * `apiCall` throws bare errors carrying an HTTP `status`, which the global
 * handler can only turn into a 500. The caller needs to tell four situations
 * apart, because each one asks the person to do something different.
 */
export function mapQboLookupFailure(err: unknown): unknown {
    const message = err instanceof Error ? err.message : '';
    const status = (err as { status?: number } | null)?.status;
    if (message.startsWith('No QBO connection') || message.includes('reconnect required') || status === 401 || status === 403) {
        return Errors.Conflict('QuickBooks is not connected', { reason: 'qbo_not_connected' });
    }
    // Intuit answers 400 (Fault 610) for an object that does not exist.
    if (status === 400 || status === 404) {
        return Errors.BadRequest('QuickBooks has no such customer', { reason: 'qbo_customer_not_found' });
    }
    if (status === 429 || (status !== undefined && status >= 500)) {
        return Errors.ServiceUnavailable('QuickBooks is not responding', { reason: 'qbo_unavailable' });
    }
    return err;
}

/**
 * Pointing a contact at an existing QuickBooks customer by hand, undoing it,
 * and reading where it stands. The automatic sync only matches on email, so this
 * is the remedy when it created a duplicate or could not match.
 */
export function withCustomerLink<TBase extends Constructor<QBOServiceBase>>(Base: TBase) {
    return class extends Base {
        async linkExistingCustomer(
            tenantId: string,
            contactId: string,
            qboCustomerId: string,
            actorUserId: string,
        ): Promise<LinkResult> {
            const db = this.getDrizzle();
            await requireContact(db, tenantId, contactId, true);

            // The reverse unique index (tenant, qboType, qboId) is NOT the
            // conflict target of the write below, so look first and name the
            // holder. The unique key still decides a race -- see the catch.
            const takenBy = await db.select().from(qboEntityMap).where(and(
                eq(qboEntityMap.tenantId, tenantId),
                eq(qboEntityMap.qboType, 'Customer'),
                eq(qboEntityMap.qboId, qboCustomerId),
            )).get();
            if (takenBy && takenBy.oiId !== contactId) {
                throw await customerTaken(db, tenantId, takenBy.oiId);
            }

            // Ask QuickBooks where this customer stands rather than assuming:
            // the SyncToken is only '0' for a customer never edited, and a
            // customer that is inactive would fail on every later sync.
            let fetched: { Customer: { Id: string; SyncToken: string; DisplayName: string; Active?: boolean } };
            try {
                fetched = await this.apiCall<typeof fetched>(tenantId, 'GET', `customer/${qboCustomerId}`);
            } catch (err) {
                throw mapQboLookupFailure(err);
            }
            if (fetched.Customer.Active === false) {
                throw Errors.BadRequest('That QuickBooks customer is inactive', { reason: 'qbo_customer_inactive' });
            }

            const previous = await db.select().from(qboEntityMap).where(contactMapping(tenantId, contactId)).get();
            const openErrors = await db.select({ id: qboSyncErrors.id }).from(qboSyncErrors)
                .where(openContactErrors(tenantId, contactId)).all();

            const now = new Date();
            const displayName = fetched.Customer.DisplayName;
            try {
                // One batch, so a half-applied link cannot exist: either the
                // mapping is written AND the contact's open errors are closed,
                // or neither is.
                await db.batch([
                    db.insert(qboEntityMap).values({
                        id:             crypto.randomUUID(),
                        tenantId,
                        oiType:         'contact',
                        oiId:           contactId,
                        qboType:        'Customer',
                        qboId:          qboCustomerId,
                        qboSyncToken:   fetched.Customer.SyncToken,
                        syncedAt:       now,
                        qboDisplayName: displayName,
                    }).onConflictDoUpdate({
                        target: [qboEntityMap.tenantId, qboEntityMap.oiType, qboEntityMap.oiId],
                        set:    {
                            qboId:          qboCustomerId,
                            qboSyncToken:   fetched.Customer.SyncToken,
                            syncedAt:       now,
                            qboDisplayName: displayName,
                        },
                    }),
                    db.update(qboSyncErrors)
                        .set({ resolved: true, updatedAt: now, resolvedAt: now })
                        .where(openContactErrors(tenantId, contactId)),
                ]);
            } catch (err) {
                // The pre-check passed and another link won in between: the
                // unique key is the authority, and the loser is a 409, not a 500.
                if (!isUniqueViolation(err, 'qbo_entity_map.qbo_id')) throw err;
                const winner = await db.select().from(qboEntityMap).where(and(
                    eq(qboEntityMap.tenantId, tenantId),
                    eq(qboEntityMap.qboType, 'Customer'),
                    eq(qboEntityMap.qboId, qboCustomerId),
                )).get();
                if (!winner) throw err;
                throw await customerTaken(db, tenantId, winner.oiId);
            }

            const replacedQboCustomerId = previous && previous.qboId !== qboCustomerId ? previous.qboId : null;
            await auditLinked(this.db, tenantId, actorUserId, contactId, qboCustomerId, replacedQboCustomerId);
            return { qboCustomerId, displayName, replacedQboCustomerId, resolvedErrorCount: openErrors.length };
        }

        /**
         * Forget the pointer. Nothing is sent to QuickBooks: the customer there is
         * left as it is, and the next sync of this contact matches by email again.
         */
        async unlinkCustomer(tenantId: string, contactId: string, actorUserId: string): Promise<{ removed: boolean }> {
            const db = this.getDrizzle();
            // Tenant only, not `live`: an archived contact can still carry a
            // pointer, and it has to be possible to remove it.
            await requireContact(db, tenantId, contactId, false);
            const removed = await db.delete(qboEntityMap).where(contactMapping(tenantId, contactId))
                .returning({ qboId: qboEntityMap.qboId }).all();
            const first = removed[0];
            if (!first) return { removed: false };
            await auditUnlinked(this.db, tenantId, actorUserId, contactId, first.qboId);
            return { removed: true };
        }

        async getContactLink(tenantId: string, contactId: string): Promise<ContactLink> {
            const db = this.getDrizzle();
            await requireContact(db, tenantId, contactId, false);
            const mapping = await db.select({
                qboId: qboEntityMap.qboId, displayName: qboEntityMap.qboDisplayName,
            }).from(qboEntityMap).where(contactMapping(tenantId, contactId)).get();
            const openErrors = await db.select({ id: qboSyncErrors.id }).from(qboSyncErrors)
                .where(openContactErrors(tenantId, contactId)).all();
            return {
                linked:         mapping !== undefined,
                qboCustomerId:  mapping?.qboId ?? null,
                displayName:    mapping?.displayName ?? null,
                openErrorCount: openErrors.length,
            };
        }
    };
}
