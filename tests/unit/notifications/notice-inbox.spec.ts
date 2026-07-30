/**
 * Track C3 — the outward Notices inbox (design §3.11/§3.13/§3.15/§3.16).
 *
 * The rules these tests pin, each chosen against a plausible wrong alternative:
 *
 * - The inbox reads the notice HEADER by `contact_id`, never by matching the
 *   `automation_logs.recipient` STRING. Email-matching looks equivalent and
 *   silently drops every SMS row, whose recipient is a phone number.
 * - A recipient sees ONLY their own notices. This is the test that matters:
 *   the header is per-recipient by construction, so a leak here would mean
 *   another party's address is reachable from a client's bell.
 * - Staff notices (user_id set) are a different audience and must never appear
 *   in a contact's inbox — pre-C1 rows all carry user_id and mean the old
 *   "tell the staff a rule fired" thing.
 * - Dismissing a Notice must NEVER touch `automation_logs` (§3.15 invariant):
 *   the recipient tidying their inbox cannot edit the sender's audit trail.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
    listNoticesForContacts,
    unreadNoticeCountForContacts,
    markNoticesRead,
    archiveNotice,
    contactIdsForEmail,
    contactIdsForAgent,
} from '../../../server/services/notice-inbox';

const TENANT_A = '00000000-0000-0000-0000-0000000000a0';
const TENANT_B = '00000000-0000-0000-0000-0000000000b0';
const CONTACT_JANE = 'contact-jane';
const CONTACT_RAY = 'contact-ray';
const CONTACT_AGENT_A = 'contact-agent-a';
const CONTACT_AGENT_B = 'contact-agent-b';
const AGENT_USER = 'user-agent-1';
const STAFF_USER = 'user-staff-1';
const INSPECTION = 'insp-1';

let db: BetterSQLite3Database<typeof schema>;

async function seed() {
    const now = new Date();
    await db.insert(schema.tenants).values([
        { id: TENANT_A, name: 'A', slug: 'a', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: now },
        { id: TENANT_B, name: 'B', slug: 'b', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: now },
    ]);
    await db.insert(schema.users).values([
        { id: STAFF_USER, tenantId: TENANT_A, email: 'staff@a.com', name: 'Staff', passwordHash: 'x', role: 'owner', createdAt: now },
        { id: AGENT_USER, tenantId: null, email: 'agent@x.com', name: 'Agent', passwordHash: 'x', role: 'agent', createdAt: now },
    ]);
    await db.insert(schema.contacts).values([
        { id: CONTACT_JANE, tenantId: TENANT_A, type: 'client', name: 'Jane', email: 'jane@x.com', phone: '+15550001111', createdAt: now },
        { id: CONTACT_RAY, tenantId: TENANT_A, type: 'client', name: 'Ray', email: 'ray@x.com', createdAt: now },
        { id: CONTACT_AGENT_A, tenantId: TENANT_A, type: 'agent', name: 'Agent', email: 'agent@x.com', agentUserId: AGENT_USER, agentLinkedAt: now, createdAt: now },
        { id: CONTACT_AGENT_B, tenantId: TENANT_B, type: 'agent', name: 'Agent', email: 'agent@x.com', agentUserId: AGENT_USER, agentLinkedAt: now, createdAt: now },
    ]);
}

/** One notice header + its per-channel delivery attempts. */
async function notice(opts: {
    id: string;
    tenantId?: string;
    contactId?: string | null;
    userId?: string | null;
    title?: string;
    createdAt?: Date;
    readAt?: Date | null;
    archivedAt?: Date | null;
    channels?: Array<{ channel: 'email' | 'sms'; recipient: string; status: 'pending' | 'sent' | 'failed' | 'skipped'; error?: string | null }>;
}) {
    const createdAt = opts.createdAt ?? new Date();
    await db.insert(schema.notifications).values({
        id: opts.id,
        tenantId: opts.tenantId ?? TENANT_A,
        userId: opts.userId ?? null,
        contactId: opts.contactId ?? null,
        type: 'report.published',
        title: opts.title ?? 'Your report is ready',
        body: null,
        inspectionId: INSPECTION,
        entityType: 'inspection',
        entityId: INSPECTION,
        metadata: null,
        readAt: opts.readAt ?? null,
        archivedAt: opts.archivedAt ?? null,
        createdAt,
    });
    let i = 0;
    for (const ch of opts.channels ?? []) {
        await db.insert(schema.automationLogs).values({
            id: `${opts.id}-log-${i++}`,
            tenantId: opts.tenantId ?? TENANT_A,
            automationId: 'auto-1',
            inspectionId: INSPECTION,
            recipient: ch.recipient,
            recipientContactId: opts.contactId ?? null,
            channel: ch.channel,
            sendAt: createdAt,
            status: ch.status,
            error: ch.error ?? null,
            noticeId: opts.id,
        });
    }
}

describe('notice inbox — outward recipients (C3)', () => {
    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db;
        await setupSchema(setup.sqlite);
        await seed();
    });

    it('reads by contact_id, so an SMS-only notice (recipient is a PHONE) still reaches its inbox', async () => {
        await notice({
            id: 'n-sms',
            contactId: CONTACT_JANE,
            channels: [{ channel: 'sms', recipient: '+15550001111', status: 'skipped', error: 'no sms consent' }],
        });
        const rows = await listNoticesForContacts(db, { contactIds: [CONTACT_JANE] });
        expect(rows).toHaveLength(1);
        expect(rows[0]!.channels).toEqual([
            expect.objectContaining({ channel: 'sms', status: 'skipped', reasonCode: 'no sms consent' }),
        ]);
    });

    it('never returns another recipient\'s notice — no other address is reachable', async () => {
        await notice({ id: 'n-jane', contactId: CONTACT_JANE, channels: [{ channel: 'email', recipient: 'jane@x.com', status: 'sent' }] });
        await notice({ id: 'n-ray', contactId: CONTACT_RAY, channels: [{ channel: 'email', recipient: 'ray@x.com', status: 'failed', error: 'mailbox unavailable' }] });

        const rows = await listNoticesForContacts(db, { contactIds: [CONTACT_JANE] });
        expect(rows.map((r) => r.id)).toEqual(['n-jane']);
        const serialized = JSON.stringify(rows);
        expect(serialized).not.toContain('ray@x.com');
    });

    it('never returns a STAFF notice (user_id set) to a contact inbox', async () => {
        await notice({ id: 'n-staff', userId: STAFF_USER, contactId: null, title: 'Report published' });
        const rows = await listNoticesForContacts(db, { contactIds: [CONTACT_JANE, CONTACT_RAY] });
        expect(rows).toHaveLength(0);
    });

    it('an agent inbox spans tenants — one query over every contact row that is them', async () => {
        await notice({ id: 'n-a', tenantId: TENANT_A, contactId: CONTACT_AGENT_A, createdAt: new Date(1_000) });
        await notice({ id: 'n-b', tenantId: TENANT_B, contactId: CONTACT_AGENT_B, createdAt: new Date(2_000) });
        const ids = await contactIdsForAgent(db, AGENT_USER);
        expect(ids.sort()).toEqual([CONTACT_AGENT_A, CONTACT_AGENT_B].sort());
        const rows = await listNoticesForContacts(db, { contactIds: ids });
        // Newest first.
        expect(rows.map((r) => r.id)).toEqual(['n-b', 'n-a']);
        // An inbox spanning companies has to say which one sent each notice,
        // so the name is resolved here rather than left as a tenant id the UI
        // would have to look up.
        expect(rows.map((r) => r.companyName)).toEqual(['B', 'A']);
    });

    it('the client lookup is tenant-scoped: the same email in another tenant is a different person here', async () => {
        await db.insert(schema.contacts).values({
            id: 'contact-jane-b', tenantId: TENANT_B, type: 'client', name: 'Jane', email: 'jane@x.com', createdAt: new Date(),
        });
        const ids = await contactIdsForEmail(db, TENANT_A, 'JANE@x.com');
        expect(ids).toEqual([CONTACT_JANE]);
    });

    it('unread count excludes read and archived rows', async () => {
        await notice({ id: 'n-1', contactId: CONTACT_JANE });
        await notice({ id: 'n-2', contactId: CONTACT_JANE, readAt: new Date() });
        await notice({ id: 'n-3', contactId: CONTACT_JANE, archivedAt: new Date() });
        expect(await unreadNoticeCountForContacts(db, [CONTACT_JANE])).toBe(1);
    });

    it('markNoticesRead only touches rows the caller owns', async () => {
        await notice({ id: 'n-jane', contactId: CONTACT_JANE });
        await notice({ id: 'n-ray', contactId: CONTACT_RAY });
        await markNoticesRead(db, [CONTACT_JANE], ['n-jane', 'n-ray']);
        expect(await unreadNoticeCountForContacts(db, [CONTACT_JANE])).toBe(0);
        expect(await unreadNoticeCountForContacts(db, [CONTACT_RAY])).toBe(1);
    });

    it('dismissing a Notice archives the header and leaves the delivery ledger untouched (§3.15)', async () => {
        await notice({
            id: 'n-jane',
            contactId: CONTACT_JANE,
            channels: [{ channel: 'email', recipient: 'jane@x.com', status: 'sent' }],
        });
        await archiveNotice(db, [CONTACT_JANE], 'n-jane');

        expect(await listNoticesForContacts(db, { contactIds: [CONTACT_JANE] })).toHaveLength(0);
        // The Outbox still shows the delivery, with its status, forever.
        const logs = await db.select().from(schema.automationLogs).all();
        expect(logs).toHaveLength(1);
        expect(logs[0]!.status).toBe('sent');
        expect(logs[0]!.noticeId).toBe('n-jane');
    });

    it('archiveNotice cannot be aimed at someone else\'s notice', async () => {
        await notice({ id: 'n-ray', contactId: CONTACT_RAY });
        await archiveNotice(db, [CONTACT_JANE], 'n-ray');
        expect(await listNoticesForContacts(db, { contactIds: [CONTACT_RAY] })).toHaveLength(1);
    });

    it('an empty contact set reads nothing rather than everything', async () => {
        await notice({ id: 'n-jane', contactId: CONTACT_JANE });
        expect(await listNoticesForContacts(db, { contactIds: [] })).toHaveLength(0);
        expect(await unreadNoticeCountForContacts(db, [])).toBe(0);
    });
});
