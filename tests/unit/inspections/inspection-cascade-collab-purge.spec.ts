/**
 * deleteInspectionCascade and the collaborative-document storage of the
 * reports it removes.
 *
 * Each report has a Durable Object addressed by `${tenantId}:${reportId}`.
 * Deleting the inspection rows without emptying that object leaves the report's
 * prose and photo keys readable by anyone who can still name it. The purge is
 * best effort: a failure is reported in the return value and must not undo the
 * delete. Every refusal below is paired with a positive control.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { deleteInspectionCascade } from '../../../server/services/inspection/inspection-cascade';
import { collabDocName } from '../../../server/lib/collab/doc-name';
import { logger } from '../../../server/lib/logger';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';

const TENANT = '00000000-0000-0000-0000-000000000001';
const INSP = 'i-1';
const OTHER_INSP = 'i-2';

const r2 = { list: async () => ({ objects: [], truncated: false }), delete: async () => undefined } as unknown as R2Bucket;

interface Seen { name: string; method: string | undefined; url: string; inspectionRowPresent: boolean; reportRowsPresent: number }

function fakeNamespace(db: BetterSQLite3Database<typeof schema>, behaviour: (name: string) => Response | Error = () => Response.json({ purged: true })) {
    const seen: Seen[] = [];
    const ns = {
        idFromName: (name: string) => name as unknown as DurableObjectId,
        get: (id: DurableObjectId) => ({
            fetch: async (url: string, init?: RequestInit) => {
                const name = id as unknown as string;
                seen.push({
                    name, method: init?.method, url,
                    inspectionRowPresent: db.select().from(schema.inspections).where(eq(schema.inspections.id, INSP)).all().length > 0,
                    reportRowsPresent: db.select().from(schema.reports).where(eq(schema.reports.inspectionId, INSP)).all().length,
                });
                const result = behaviour(name);
                if (result instanceof Error) throw result;
                return result;
            },
        }),
    } as unknown as DurableObjectNamespace;
    return { ns, seen };
}

describe('deleteInspectionCascade: collaborative document storage', () => {
    let db: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        await setupSchema(fix.sqlite);
        await db.insert(schema.tenants).values({ id: TENANT, slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() });
        for (const id of [INSP, OTHER_INSP]) {
            await db.insert(schema.inspections).values({
                id, tenantId: TENANT, propertyAddress: `${id} St`, date: '2026-06-01', status: 'requested',
                paymentStatus: 'unpaid', price: 0, agreementRequired: false, paymentRequired: false, createdAt: new Date(),
            });
        }
        const report = (id: string, inspectionId: string) => ({
            id, tenantId: TENANT, inspectionId, kind: 'primary', title: id, status: 'draft', createdAt: new Date(),
        });
        await db.insert(schema.reports).values([
            report('rep-a', INSP), { ...report('rep-b', INSP), kind: 'secondary' }, report('rep-other', OTHER_INSP),
        ] as never);
        vi.restoreAllMocks();
    });

    const run = (ns?: DurableObjectNamespace) =>
        deleteInspectionCascade(db as unknown as DrizzleD1Database, r2, TENANT, INSP, ns);

    it('purges the object of each report the inspection owned, once each, with a POST to /purge', async () => {
        const { ns, seen } = fakeNamespace(db);
        expect(await run(ns)).toBe('ok');
        expect(seen.map((s) => s.name).sort()).toEqual([collabDocName(TENANT, 'rep-a'), collabDocName(TENANT, 'rep-b')]);
        expect(seen.every((s) => s.method === 'POST' && s.url === 'https://do/purge')).toBe(true);
    });

    it('never names another inspection report or another tenant object (positive control: its own reports are purged)', async () => {
        const { ns, seen } = fakeNamespace(db);
        await run(ns);
        const names = seen.map((s) => s.name);
        expect(names).toContain(collabDocName(TENANT, 'rep-a'));
        expect(names).not.toContain(collabDocName(TENANT, 'rep-other'));
        expect(names.every((n) => n.startsWith(`${TENANT}:`))).toBe(true);
    });

    it('fetches the report ids before deleting and purges only after the delete completed', async () => {
        const { ns, seen } = fakeNamespace(db);
        await run(ns);
        expect(seen).toHaveLength(2);
        // The ids came from rows that no longer exist when the purge ran.
        for (const s of seen) {
            expect(s.inspectionRowPresent).toBe(false);
            expect(s.reportRowsPresent).toBe(0);
        }
        // And the sibling inspection was not touched.
        expect((await db.select().from(schema.inspections).all()).map((i) => i.id)).toEqual([OTHER_INSP]);
    });

    it('a purge that throws leaves the inspection deleted and is reported as failed, with a warning that carries the inspection id and no content', async () => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
        const { ns } = fakeNamespace(db, (name) => (name.endsWith('rep-a') ? new Error('storage unavailable: secret prose') : Response.json({ purged: true })));
        expect(await run(ns)).toBe('failed');
        expect((await db.select().from(schema.inspections).all()).map((i) => i.id)).toEqual([OTHER_INSP]);
        expect(warn).toHaveBeenCalledTimes(1);
        const [message, data] = warn.mock.calls[0]!;
        expect(message).toMatch(/collab/i);
        expect(data).toMatchObject({ tenantId: TENANT, inspectionId: INSP });
        expect(JSON.stringify(warn.mock.calls)).not.toContain('secret prose');
    });

    it('a non-ok response counts as failed', async () => {
        vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
        const { ns } = fakeNamespace(db, () => new Response('nope', { status: 500 }));
        expect(await run(ns)).toBe('failed');
        expect(await db.select().from(schema.inspections).all()).toHaveLength(1);
    });

    it('a purge that succeeds logs no warning', async () => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
        const { ns } = fakeNamespace(db);
        expect(await run(ns)).toBe('ok');
        expect(warn).not.toHaveBeenCalled();
    });

    it('an unbound namespace is skipped without error, and the delete still happens', async () => {
        expect(await run(undefined)).toBe('skipped');
        expect((await db.select().from(schema.inspections).all()).map((i) => i.id)).toEqual([OTHER_INSP]);
    });

    it('an inspection with no reports is skipped and the namespace is not called', async () => {
        await db.delete(schema.reports).where(eq(schema.reports.inspectionId, INSP));
        const { ns, seen } = fakeNamespace(db);
        expect(await run(ns)).toBe('skipped');
        expect(seen).toEqual([]);
    });
});
