import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, setupSchema } from './db';
import { syncOutbox, users, tenants } from '../../server/lib/db/schema';
import { eq } from 'drizzle-orm';
import { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../server/lib/db/schema';

// Route every drizzle(d1) call inside the services under test to the
// in-memory SQLite test DB (the established pattern in this suite).
vi.mock('drizzle-orm/d1', () => ({
    drizzle: vi.fn(),
}));

import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { OutboxService, publishRow, flushOutboxOnce } from '../../server/portal/outbox.service';
import { handleSyncDlqBatch } from '../../server/portal/integration.module';
import { TeamService } from '../../server/services/team.service';

type SentEnvelope = { id: string; type: string; dataschema: string; data: Record<string, unknown> };

function mockQueue() {
    const sent: SentEnvelope[] = [];
    return {
        sent,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        queue: { send: vi.fn(async (e: any) => { sent.push(e); }) } as any,
    };
}

const NOW = () => Math.floor(Date.now() / 1000);

async function insertRow(
    db: BetterSQLite3Database<typeof schema>,
    over: Partial<typeof syncOutbox.$inferInsert> = {},
) {
    const id = over.id ?? crypto.randomUUID();
    await db.insert(syncOutbox).values({
        id,
        eventType: 'user.invited',
        payload: JSON.stringify({ tenantId: 't1', email: 'a@example.com', role: 'member', passwordHash: 'h' }),
        status: 'pending',
        attempts: 0,
        createdAt: NOW(),
        ...over,
    });
    return id;
}

describe('sync outbox — queue transport (A-13/A-14)', () => {
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const { sqlite, db } = createTestDb();
        await setupSchema(sqlite);
        testDb = db;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
    });

    it('publishRow sends a CloudEvents envelope and marks the row published', async () => {
        const id = await insertRow(testDb);
        const { queue, sent } = mockQueue();
        const row = (await testDb.select().from(syncOutbox).where(eq(syncOutbox.id, id)).get())!;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await publishRow({} as any, queue, row as any);

        expect(sent).toHaveLength(1);
        expect(sent[0]).toMatchObject({
            specversion: '1.0',
            id,
            type: 'io.inspectorhub.user.invited',
            source: 'core',
            dataschema: 'user-invited/v1',
        });
        expect(sent[0]!.data['email']).toBe('a@example.com');
        const after = await testDb.select().from(syncOutbox).where(eq(syncOutbox.id, id)).get();
        expect(after!.status).toBe('published');
    });

    it('publishRow leaves the row pending when queue.send throws', async () => {
        const id = await insertRow(testDb);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const queue = { send: vi.fn(async () => { throw new Error('queue down'); }) } as any;
        const row = (await testDb.select().from(syncOutbox).where(eq(syncOutbox.id, id)).get())!;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await expect(publishRow({} as any, queue, row as any)).rejects.toThrow('queue down');
        const after = await testDb.select().from(syncOutbox).where(eq(syncOutbox.id, id)).get();
        expect(after!.status).toBe('pending');
    });

    it('sweeper publishes only rows older than the inline-publish window', async () => {
        const fresh = await insertRow(testDb); // createdAt = now → must NOT sweep
        const stale = await insertRow(testDb, { createdAt: NOW() - 300 });
        const { queue, sent } = mockQueue();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = await flushOutboxOnce({} as any, queue, 50);

        expect(res.published).toBe(1);
        expect(sent.map((e) => e.id)).toEqual([stale]);
        const freshRow = await testDb.select().from(syncOutbox).where(eq(syncOutbox.id, fresh)).get();
        expect(freshRow!.status).toBe('pending');
        const staleRow = await testDb.select().from(syncOutbox).where(eq(syncOutbox.id, stale)).get();
        expect(staleRow!.status).toBe('published');
    });

    it('redrive resets failed rows to pending (all + selective)', async () => {
        const f1 = await insertRow(testDb, { status: 'failed', lastError: 'x' });
        const f2 = await insertRow(testDb, { status: 'failed', lastError: 'y' });
        const done = await insertRow(testDb, { status: 'published' });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const svc = new OutboxService({} as any);

        expect(await svc.redrive([f1])).toBe(1);
        expect((await testDb.select().from(syncOutbox).where(eq(syncOutbox.id, f1)).get())!.status).toBe('pending');
        expect((await testDb.select().from(syncOutbox).where(eq(syncOutbox.id, f2)).get())!.status).toBe('failed');

        expect(await svc.redrive()).toBe(1); // sweeps the remaining failed row
        expect((await testDb.select().from(syncOutbox).where(eq(syncOutbox.id, f2)).get())!.status).toBe('pending');
        expect((await testDb.select().from(syncOutbox).where(eq(syncOutbox.id, done)).get())!.status).toBe('published');
    });

    it('counts reports pending/failed and the oldest pending age', async () => {
        await insertRow(testDb, { createdAt: NOW() - 600 });
        await insertRow(testDb);
        await insertRow(testDb, { status: 'failed' });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const c = await new OutboxService({} as any).counts();
        expect(c.pending).toBe(2);
        expect(c.failed).toBe(1);
        expect(c.oldestPendingAge).toBeGreaterThanOrEqual(590);
    });

    it('DLQ writeback marks the originating row failed and always acks', async () => {
        const id = await insertRow(testDb, { status: 'published' });
        const ack1 = vi.fn();
        const ack2 = vi.fn();
        const batch = {
            messages: [
                { id: 'm1', body: { id }, attempts: 5, ack: ack1, retry: vi.fn() },
                { id: 'm2', body: 'not-an-envelope', attempts: 5, ack: ack2, retry: vi.fn() },
            ],
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await handleSyncDlqBatch({} as any, batch as any);

        const after = await testDb.select().from(syncOutbox).where(eq(syncOutbox.id, id)).get();
        expect(after!.status).toBe('failed');
        expect(after!.lastError).toContain('dlq');
        expect(ack1).toHaveBeenCalled();
        expect(ack2).toHaveBeenCalled(); // malformed body still acked, never recycled
    });

    it('append fires the inline-publish hook with the inserted row', async () => {
        const seen: string[] = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const svc = new OutboxService({} as any, (row) => { seen.push(row.id); });
        const id = await svc.append({ type: 'user.deleted', payload: { tenantId: 't1', email: 'x@example.com' } });
        expect(seen).toEqual([id]);
        const row = await testDb.select().from(syncOutbox).where(eq(syncOutbox.id, id)).get();
        expect(row!.status).toBe('pending'); // hook is fire-and-forget; status moves in publishRow
    });

    it('TeamService.removeMember emits user.deleted with the pre-delete email', async () => {
        await testDb.insert(tenants).values({ id: 't1', name: 'T1', slug: 't1', createdAt: new Date() } as typeof tenants.$inferInsert);
        await testDb.insert(users).values({
            id: 'u-victim', tenantId: 't1', email: 'victim@example.com',
            passwordHash: 'hash', role: 'member', createdAt: new Date(),
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const outbox = new OutboxService({} as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const team = new TeamService({} as any, outbox);

        await team.removeMember('t1', 'u-victim', 'u-admin');

        const rows = await testDb.select().from(syncOutbox).where(eq(syncOutbox.eventType, 'user.deleted')).all();
        expect(rows).toHaveLength(1);
        expect(JSON.parse(rows[0]!.payload)).toEqual({ tenantId: 't1', email: 'victim@example.com' });
        const gone = await testDb.select().from(users).where(eq(users.id, 'u-victim')).get();
        expect(gone).toBeUndefined();
    });
});
