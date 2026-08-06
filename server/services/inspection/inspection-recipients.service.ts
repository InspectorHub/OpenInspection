import { eq, and } from 'drizzle-orm';
import { inspections, users } from '../../lib/db/schema';
import { PeopleService } from '../people.service';
import { Errors } from '../../lib/errors';
import { InspectionSubService } from './base';

/** Internal — one Publish-modal recipient row (client or agent). Not exported:
 *  the public `getRecipientList` signature keeps its inline structural type. */
interface InspectionRecipient {
    contactId: string | null;
    name:      string;
    role:      'client' | 'agent_buyer' | 'agent_listing';
    email:     string | null;
    phone:     string | null;
}

/** `contact_role_profiles.key` → `InspectionRecipient.role`, for the three
 *  roles `getRecipientList` covers. Other role keys (co_client, attorney,
 *  ...) are intentionally absent — Spec 2 widens the recipient set. */
const RECIPIENT_ROLE_MAP: Record<string, 'client' | 'agent_buyer' | 'agent_listing'> = {
    client:        'client',
    buyer_agent:   'agent_buyer',
    listing_agent: 'agent_listing',
};

/**
 * WHO is attached to an inspection, read two ways.
 *
 * `getRecipientList` answers "who can this report be delivered to" for the
 * Publish modal — a flat list restricted to the three roles that contract
 * covers, with anyone unreachable (no email AND no phone) dropped.
 * `getPeopleCard` answers "who is on this job" for the inspector portal — the
 * same `inspection_people` join, grouped by role and including the assigned
 * inspector.
 *
 * They share a file because they share the source of truth and must not
 * disagree about it: `inspection_people` via `PeopleService.listPeople` is the
 * ONLY persistence of who, since Task 13 dropped the legacy contact columns
 * from `inspections`. A second reader that reached for those columns would
 * quietly resurrect GDPR-erased names.
 */
export class InspectionRecipientsService extends InspectionSubService {
    /**
     * Round-2 F1 — list every party associated with an inspection so the
     * Publish modal can render per-recipient Email + Text checkboxes.
     *
     * Sourced from `PeopleService.listPeople` (the `inspection_people` join),
     * restricted to the three roles this Publish-modal contract covers
     * (`client` / `buyer_agent` / `listing_agent` — see `RECIPIENT_ROLE_MAP`);
     * other role kinds (co_client, attorney, ...) are ignored here (Spec 2
     * widens the recipient set).
     *
     * Returned shape (`InspectionRecipient[]`):
     *   - role: 'client' | 'agent_buyer' | 'agent_listing'
     *   - contactId: the person's contact row id (now populated for every
     *     role, including the client — the legacy inline-client column had
     *     no contact row, so this used to be null for `role: 'client'`)
     *   - name, email, phone
     *
     * Recipients without any contact info (no email AND no phone) are dropped
     * because there is no way to deliver to them. Tenant-scoped via the
     * compound `where(eq(id), eq(tenantId))` guard on the inspection lookup
     * AND `PeopleService.listPeople`'s own tenant filter.
     */
    async getRecipientList(inspectionId: string, tenantId: string): Promise<InspectionRecipient[]> {
        const db = this.getDrizzle();

        const inspection = await db.select().from(inspections)
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
            .get();
        if (!inspection) throw Errors.NotFound('Inspection not found');

        const people = await new PeopleService({ DB: this.db }).listPeople(tenantId, inspectionId);

        const recipients: InspectionRecipient[] = [];
        for (const p of people) {
            const role = RECIPIENT_ROLE_MAP[p.roleKey];
            if (!role) continue; // ignore co_client/attorney/etc — Spec 2 widens the recipient set
            if (!p.email && !p.phone) continue; // no delivery channel
            recipients.push({
                contactId: p.contactId,
                name:      p.name,
                role,
                email:     p.email ?? null,
                phone:     p.phone ?? null,
            });
        }

        return recipients;
    }

    /**
     * Round-2 F3 — People card payload (Spectora §E.2 / §4.1).
     *
     * Groups every party connected to an inspection by role so the inspection
     * Settings page can render a contact card with role chips:
     *
     *   - Inspector  → users row referenced by inspectorId
     *   - Client, Buyer's Agent, Listing Agent → `inspection_people` rows
     *     (via `PeopleService.listPeople`), matched on `roleKey`. Other role
     *     kinds (co_client, attorney, ...) are ignored here (Spec 2 widens
     *     the people card).
     *
     * Each agent's `.id` is the CONTACT id (`p.contactId`), matching the old
     * contract — NOT the `inspection_people` join-row id (`p.id`).
     *
     * Schema currently allows ONE buyer agent + ONE listing agent per
     * inspection. The result returns arrays for forward-compat (so the UI
     * can render "Buyer's Agent · 2" if multi-agent ever ships) without a
     * follow-up service refactor.
     */
    async getPeopleCard(inspectionId: string, tenantId: string): Promise<{
        inspector:     { id: string; name: string | null; email: string; phone: string | null } | null;
        client:        { name: string; email: string | null; phone: string | null } | null;
        buyerAgents:   Array<{ id: string; name: string; email: string | null; phone: string | null; agency: string | null }>;
        listingAgents: Array<{ id: string; name: string; email: string | null; phone: string | null; agency: string | null }>;
    }> {
        const db = this.getDrizzle();

        const inspection = await db.select().from(inspections)
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
            .get();
        if (!inspection) throw Errors.NotFound('Inspection not found');

        // Inspector — users table (tenant-scoped).
        let inspector: { id: string; name: string | null; email: string; phone: string | null } | null = null;
        if (inspection.inspectorId) {
            const u = await db.select().from(users)
                .where(and(eq(users.id, inspection.inspectorId as string), eq(users.tenantId, tenantId)))
                .get();
            if (u) {
                inspector = {
                    id:    u.id as string,
                    name:  (u.name  as string | null) ?? null,
                    email: u.email as string,
                    phone: (u.phone as string | null) ?? null,
                };
            }
        }

        // Client + agents — from inspection_people (via PeopleService).
        const people = await new PeopleService({ DB: this.db }).listPeople(tenantId, inspectionId);

        const clientP = people.find(p => p.roleKey === 'client') ?? null;
        const client = clientP
            ? {
                name:  clientP.name,
                email: clientP.email ?? null,
                phone: clientP.phone ?? null,
            }
            : null;

        const toAgent = (p: (typeof people)[number]) => ({
            id:     p.contactId, // CONTACT id — matches the old contract, not the join-row id
            name:   p.name,
            email:  p.email  ?? null,
            phone:  p.phone  ?? null,
            agency: p.agency ?? null,
        });
        const buyerAgents   = people.filter(p => p.roleKey === 'buyer_agent').map(toAgent);
        const listingAgents = people.filter(p => p.roleKey === 'listing_agent').map(toAgent);

        return {
            inspector,
            client,
            buyerAgents,
            listingAgents,
        };
    }
}
