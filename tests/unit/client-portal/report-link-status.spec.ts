/**
 * OI #271 condition 6 — what the inspector is told about a report reaching a
 * recipient, and the third state that keeps it honest.
 *
 * The failure this suite is really about is not a wrong pixel. It is an
 * inspector telephoning a client to ask why they have not read a report that
 * never left the building. The automation ledger hides notices whose `send_at`
 * is in the future — reasonably, since a "pending" row dated tomorrow reads as
 * a failure — so a two-state UI has no way to distinguish "sent and unread"
 * from "not sent yet", and picks the accusatory one.
 *
 * The other thing pinned here is scope: these rows are keyed on the ORDER, not
 * on a deliverable (LIA §3.4(b)). A test that only checked counts would stay
 * green through a change that started attributing an order-scoped open to one
 * report.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
    foldReportNotices, listReportLinkStatus, reportLinkState,
} from '../../../server/lib/report-view-status';

const TENANT = '00000000-0000-0000-0000-0000000000c3';
const INSP = 'insp-271-status';
const NOW = Date.parse('2026-08-07T12:00:00Z');
const HOUR = 3_600_000;

describe('reportLinkState — three states, and the order of precedence', () => {
    it('an open outranks everything', () => {
        expect(reportLinkState({ viewCount: 1, sentAt: null, scheduledAt: NOW })).toBe('opened');
    });

    it('delivered-but-unopened is its own state, not a zero dressed as one', () => {
        expect(reportLinkState({ viewCount: 0, sentAt: NOW - HOUR, scheduledAt: null })).toBe('delivered');
    });

    it('a notice still queued is NOT "not yet opened"', () => {
        // The whole reason the third state exists: nothing has been sent, so
        // there is no open status to report and the UI must not invent one.
        expect(reportLinkState({ viewCount: 0, sentAt: null, scheduledAt: NOW + HOUR })).toBe('queued');
    });

    it('a delivered notice plus a scheduled amendment still reads as delivered', () => {
        // "Scheduled to send" would be the LESS true of the two — this person
        // already has the report.
        expect(reportLinkState({ viewCount: 0, sentAt: NOW - HOUR, scheduledAt: NOW + HOUR })).toBe('delivered');
    });
});

describe('foldReportNotices', () => {
    it('takes the LATEST successful send and the EARLIEST future one', () => {
        const fact = foldReportNotices([
            { sendAt: NOW - 5 * HOUR, status: 'sent' },
            { sendAt: NOW - HOUR, status: 'sent' },
            { sendAt: NOW + 4 * HOUR, status: 'pending' },
            { sendAt: NOW + 2 * HOUR, status: 'pending' },
        ], NOW);
        expect(fact.sentAt).toBe(NOW - HOUR);
        expect(fact.scheduledAt).toBe(NOW + 2 * HOUR);
    });

    it('a due row that FAILED is not a delivery', () => {
        // Distinguishing this from an unread inbox is the pairing condition 6
        // asks for; the Outbox next to the list carries the reason.
        expect(foldReportNotices([{ sendAt: NOW - HOUR, status: 'failed' }], NOW).sentAt).toBeNull();
        expect(foldReportNotices([{ sendAt: NOW - HOUR, status: 'skipped' }], NOW).sentAt).toBeNull();
    });
});

describe('listReportLinkStatus', () => {
    let db: BetterSQLite3Database<typeof schema>;

    async function token(id: string, email: string, role = 'client', objectedAt: Date | null = null) {
        await db.insert(schema.inspectionAccessTokens).values({
            id, tenantId: TENANT, inspectionId: INSP, recipientEmail: email, role,
            token: `tok-${id}`, createdAt: new Date(NOW - 10 * HOUR),
            viewTrackingObjectedAt: objectedAt,
        });
    }
    async function log(recipient: string, sendAt: number, status: 'sent' | 'pending' | 'failed', automationId: string | null = null) {
        await db.insert(schema.automationLogs).values({
            id: crypto.randomUUID(), tenantId: TENANT, automationId, inspectionId: INSP,
            recipient, channel: 'email', sendAt: new Date(sendAt), status,
        });
    }
    async function view(accessTokenId: string, count: number, first: number, last: number) {
        await db.insert(schema.reportViews).values({
            id: crypto.randomUUID(), tenantId: TENANT, inspectionId: INSP, accessTokenId,
            viewCount: count, firstViewedAt: new Date(first), lastViewedAt: new Date(last),
        });
    }
    const run = () => listReportLinkStatus(db as never, TENANT, INSP, NOW);

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        await setupSchema(fix.sqlite);
        await db.insert(schema.tenants).values({
            id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(NOW),
        });
    });

    it('reports a queued notice as queued, with its send time and NO open status', async () => {
        await token('t1', 'client@x.com');
        await log('client@x.com', NOW + 2 * HOUR, 'pending');
        const [row] = await run();
        expect(row.state).toBe('queued');
        expect(row.scheduledAt).toBe(NOW + 2 * HOUR);
        expect(row.sentAt).toBeNull();
        expect(row.viewCount).toBe(0);
    });

    it('reports a delivered, unopened notice with the delivery time', async () => {
        await token('t1', 'client@x.com');
        await log('client@x.com', NOW - 2 * HOUR, 'sent');
        const [row] = await run();
        expect(row.state).toBe('delivered');
        expect(row.sentAt).toBe(NOW - 2 * HOUR);
    });

    it('reports opens with the count and both timestamps', async () => {
        await token('t1', 'client@x.com');
        await log('client@x.com', NOW - 3 * HOUR, 'sent');
        await view('t1', 3, NOW - 2 * HOUR, NOW - HOUR);
        const [row] = await run();
        expect(row.state).toBe('opened');
        expect(row.viewCount).toBe(3);
        expect(row.firstViewedAt).toBe(NOW - 2 * HOUR);
        expect(row.lastViewedAt).toBe(NOW - HOUR);
    });

    it('carries the Art. 21 objection, so "not yet opened" is never read as a fact about a suppressed recipient', async () => {
        await token('t1', 'client@x.com', 'client', new Date(NOW - HOUR));
        await log('client@x.com', NOW - 2 * HOUR, 'sent');
        const [row] = await run();
        expect(row.trackingObjected).toBe(true);
        // The count is zero because we stopped counting, not because nothing
        // happened — the surface must be able to say which.
        expect(row.state).toBe('delivered');
    });

    it('counts a MANUAL send as a report send', async () => {
        // `automation_id IS NULL` is the ledger's manual marker, and the only
        // caller of makeManualSendLogger is the report-delivery route. If a
        // second manual-send path ever appears, this is the assumption to
        // revisit.
        await token('t1', 'client@x.com');
        await log('client@x.com', NOW - HOUR, 'sent', null);
        expect((await run())[0].state).toBe('delivered');
    });

    it('ignores notices that carry no report link', async () => {
        await token('t1', 'client@x.com');
        await db.insert(schema.automations).values({
            id: 'auto-1', tenantId: TENANT, name: 'Payment reminder', trigger: 'invoice.created',
            recipientKind: 'role', active: true, createdAt: new Date(NOW - 5 * HOUR),
            subjectTemplate: '', bodyTemplate: '',
        });
        await log('client@x.com', NOW - HOUR, 'sent', 'auto-1');
        // Nothing to report: an invoice email is not a report delivery, and a
        // recipient with no report notice has no delivery question yet.
        expect(await run()).toEqual([]);
    });

    it('is per RECIPIENT, and never per deliverable', async () => {
        // The counter is keyed (tenant, inspection, access_token) with no
        // report_id, deliberately (LIA §3.4(b)). Two recipients, two rows —
        // and no row ever names a report.
        await token('t1', 'client@x.com', 'client');
        await token('t2', 'agent@x.com', 'buyer_agent');
        await log('client@x.com', NOW - 2 * HOUR, 'sent');
        await log('agent@x.com', NOW - 2 * HOUR, 'sent');
        await view('t1', 2, NOW - HOUR, NOW - HOUR);
        const rows = await run();
        expect(rows).toHaveLength(2);
        expect(rows.map((r) => r.state).sort()).toEqual(['delivered', 'opened']);
        for (const r of rows) expect(Object.keys(r)).not.toContain('reportId');
    });

    it('omits a recipient who was issued a link but sent nothing', async () => {
        await token('t1', 'client@x.com');
        expect(await run()).toEqual([]);
    });

    it('matches the log to the token case-insensitively', async () => {
        await token('t1', 'Client@X.com');
        await log('client@x.com', NOW - HOUR, 'sent');
        expect((await run())[0].state).toBe('delivered');
    });
});
