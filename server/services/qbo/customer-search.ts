import { and, eq, inArray } from 'drizzle-orm';
import { contacts } from '../../lib/db/schema/contact';
import { qboEntityMap } from '../../lib/db/schema/qbo';
import { Errors } from '../../lib/errors';
import { mapQboLookupFailure } from './connection-link';
import type { Constructor, QBOServiceBase } from './api-base';

/** One row of the picker. Deliberately has no SyncToken: that is Intuit's, not the browser's. */
export interface CustomerSearchRow {
    id: string;
    displayName: string;
    companyName: string | null;
    email: string | null;
    phone: string | null;
    active: boolean;
    /** The contact of THIS company that already holds this customer, if any. */
    linkedContactId: string | null;
    linkedContactName: string | null;
}

interface QboCustomerRow {
    Id: string;
    DisplayName?: string;
    CompanyName?: string;
    PrimaryEmailAddr?: { Address?: string };
    PrimaryPhone?: { FreeFormNumber?: string };
    Active?: boolean;
}

const MAX_RESULTS = 20;

const clampPaging = (startPosition: number, limit: number) => ({
    pos: Math.max(1, Math.floor(startPosition)),
    max: Math.min(MAX_RESULTS, Math.max(1, Math.floor(limit))),
});

/** Quote and backslash: what keeps typed text inside a QuickBooks string literal. */
const escapeQboString = (input: string): string => input.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/**
 * Typed text as the inside of a QuickBooks `LIKE '%...%'` literal: the quote and
 * backslash cannot end the literal, and `%` / `_` match themselves rather than
 * widening the search.
 */
export function escapeQboLike(input: string): string {
    // One pass over every character that needs a backslash in front of it, so the
    // backslash itself is escaped in the same step as the rest.
    return input.replace(/[\\'%_]/g, (ch) => `\\${ch}`);
}

/**
 * The query for the picker. Active customers only: a match to an inactive one
 * would fail on every later sync. Text containing `@` is an email address and is
 * looked up exactly; anything else is a display-name substring.
 */
export function buildCustomerSearchQuery(q: string, startPosition: number, limit: number): string {
    const text = q.trim();
    const { pos, max } = clampPaging(startPosition, limit);
    const condition = text.includes('@')
        ? `PrimaryEmailAddr = '${escapeQboString(text)}'`
        : `DisplayName LIKE '%${escapeQboLike(text)}%'`;
    return `SELECT Id, DisplayName, CompanyName, PrimaryEmailAddr, PrimaryPhone, Active FROM Customer `
        + `WHERE Active = true AND ${condition} ORDERBY DisplayName STARTPOSITION ${pos} MAXRESULTS ${max}`;
}

/**
 * Finding the QuickBooks customer a contact should be matched to. Reads only:
 * nothing here writes to QuickBooks or to the mapping table.
 */
export function withCustomerSearch<TBase extends Constructor<QBOServiceBase>>(Base: TBase) {
    return class extends Base {
        async searchCustomers(
            tenantId: string,
            q: string,
            startPosition: number,
            limit: number,
        ): Promise<{ customers: CustomerSearchRow[]; nextStartPosition: number | null }> {
            const { pos, max } = clampPaging(startPosition, limit);
            let found: { QueryResponse?: { Customer?: QboCustomerRow[] } };
            try {
                found = await this.qboQuery<typeof found>(tenantId, buildCustomerSearchQuery(q, pos, max));
            } catch (err) {
                // Intuit's Fault body stays server-side; the caller gets a reason it can act on.
                const status = (err as { status?: number } | null)?.status;
                if (status === 400 || status === 404) {
                    throw Errors.BadRequest('QuickBooks could not run that search', { reason: 'qbo_search_rejected' });
                }
                throw mapQboLookupFailure(err);
            }
            const rows = found.QueryResponse?.Customer ?? [];

            const holders = new Map<string, { contactId: string; name: string | null }>();
            if (rows.length > 0) {
                const db = this.getDrizzle();
                const held = await db.select({
                    qboId: qboEntityMap.qboId, contactId: qboEntityMap.oiId, name: contacts.name,
                }).from(qboEntityMap)
                    .leftJoin(contacts, and(eq(contacts.id, qboEntityMap.oiId), eq(contacts.tenantId, tenantId)))
                    .where(and(
                        eq(qboEntityMap.tenantId, tenantId),
                        eq(qboEntityMap.oiType, 'contact'),
                        eq(qboEntityMap.qboType, 'Customer'),
                        inArray(qboEntityMap.qboId, rows.map((r) => r.Id)),
                    )).all();
                for (const h of held) holders.set(h.qboId, { contactId: h.contactId, name: h.name });
            }

            return {
                customers: rows.map((r): CustomerSearchRow => {
                    const holder = holders.get(r.Id);
                    return {
                        id:                r.Id,
                        displayName:       r.DisplayName ?? '',
                        companyName:       r.CompanyName ?? null,
                        email:             r.PrimaryEmailAddr?.Address ?? null,
                        phone:             r.PrimaryPhone?.FreeFormNumber ?? null,
                        active:            r.Active !== false,
                        linkedContactId:   holder?.contactId ?? null,
                        linkedContactName: holder?.name ?? null,
                    };
                }),
                nextStartPosition: rows.length >= max ? pos + max : null,
            };
        }
    };
}
