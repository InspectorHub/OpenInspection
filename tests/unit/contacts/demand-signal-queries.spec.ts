/**
 * The multilingual demand signal is a NUMBER SOMEONE DECIDES ON, so the SQL
 * that produces it is treated as code: it lives in
 * `docs/concepts/multilingual-demand-signal.md`, and this spec runs every
 * query in that document against a database built from the real migrations.
 *
 * Two failures are worth catching mechanically, and neither one is visible to
 * a reader of the doc:
 *
 *  1. **Drift.** A renamed column leaves the queries syntactically fine and
 *     operationally dead — discovered on the day someone needs the answer,
 *     which is the one day it cannot be fixed retroactively. Executing the
 *     blocks here turns that into a red test at rename time. (Repo convention:
 *     a "must stay in sync" comment becomes an assertion, not prose.)
 *
 *  2. **A number quoted without its caveat.** The question is only asked where
 *     a client speaks for themselves; the agent-on-behalf booking path carries
 *     no `locale` at all, so those clients sit in `(not stated)` whatever they
 *     speak. A bare percentage is therefore a lie, and the caveat has to travel
 *     with the SQL rather than sit two screens above it — anything copied out
 *     of the doc must carry it. Hence the `Undercount:` assertion below.
 *
 * The fixture is deliberately adversarial about the buckets that get conflated:
 * an archived Spanish speaker, an agent contact with a locale, a stated `en`
 * (a choice, not an absence) and a NULL (an absence, not English).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';

const DOC = path.resolve(
    __dirname,
    '../../../docs/concepts/multilingual-demand-signal.md',
);

/** Every fenced ```sql block in the doc, keyed by its `-- Query X` marker. */
function sqlBlocks(): Map<string, string> {
    const markdown = readFileSync(DOC, 'utf8');
    const blocks = new Map<string, string>();
    // `\r?` because a Windows checkout has CRLF here: without it the fence
    // never matches, every block is silently missed, and the failure surfaces
    // as "doc has no -- Query D block" rather than "the parser read nothing".
    // CI is Linux so this passed there while being unrunnable on the machine
    // the doc is edited on.
    for (const match of markdown.matchAll(/```sql\r?\n([\s\S]*?)```/g)) {
        const sql = match[1];
        const label = /--\s*Query\s+([A-Z])\b/.exec(sql)?.[1];
        expect(label, `every SQL block must open with a "-- Query X" marker:\n${sql}`).toBeTruthy();
        blocks.set(label as string, sql);
    }
    return blocks;
}

const T1 = '00000000-0000-0000-0000-000000000a01';
const T2 = '00000000-0000-0000-0000-000000000a02';
const CLIENT_ROLE = 'role-client';
const AGENT_ROLE = 'role-agent';

let sqlite: ReturnType<typeof createTestDb>['sqlite'];
let blocks: Map<string, string>;

/** Run a doc query and return its rows. */
function run(label: string): Record<string, unknown>[] {
    const sql = blocks.get(label);
    if (!sql) throw new Error(`doc has no "-- Query ${label}" block`);
    return sqlite.prepare(sql).all() as Record<string, unknown>[];
}

beforeAll(async () => {
    const fixture = createTestDb();
    sqlite = fixture.sqlite;
    await setupSchema(sqlite);
    blocks = sqlBlocks();

    const db = fixture.db;
    const day = 86_400_000;
    const now = new Date('2026-08-01T12:00:00Z').getTime();

    await db.insert(schema.tenants).values([
        { id: T1, slug: 't1', createdAt: new Date(now) },
        { id: T2, slug: 't2', createdAt: new Date(now) },
    ]);

    await db.insert(schema.contacts).values([
        // Tenant 1 — the population the decision rule is about.
        { id: 'c-es', tenantId: T1, type: 'client', name: 'Stated Spanish', locale: 'es-419', createdAt: new Date(now) },
        { id: 'c-en', tenantId: T1, type: 'client', name: 'Stated English', locale: 'en', createdAt: new Date(now + day) },
        { id: 'c-null', tenantId: T1, type: 'client', name: 'Never Asked', locale: null, createdAt: new Date(now + 2 * day) },
        // Archived: retired, and must not inflate a live count.
        { id: 'c-gone', tenantId: T1, type: 'client', name: 'Archived Spanish', locale: 'es-419', createdAt: new Date(now), archivedAt: new Date(now + day) },
        // An AGENT with a stated locale: real data, but not client demand.
        { id: 'c-agent', tenantId: T1, type: 'agent', name: 'Agent With Locale', locale: 'es-419', createdAt: new Date(now) },
        // Tenant 2 — proves the per-tenant breakdown does not merge tenants.
        { id: 'c-t2', tenantId: T2, type: 'client', name: 'Other Tenant', locale: null, createdAt: new Date(now) },
    ]);

    await db.insert(schema.contactRoleProfiles).values([
        { id: CLIENT_ROLE, tenantId: T1, key: 'client', label: 'Client', kind: 'client', createdAt: new Date(now), updatedAt: new Date(now) },
        { id: AGENT_ROLE, tenantId: T1, key: 'buyer_agent', label: "Buyer's Agent", kind: 'agent', createdAt: new Date(now), updatedAt: new Date(now) },
    ]);

    await db.insert(schema.inspections).values([
        // Placed BY an agent for the client: concierge_status is set.
        { id: 'i-concierge', tenantId: T1, propertyAddress: '1 Agent Way', date: '2026-08-10', createdAt: new Date(now), conciergeStatus: 'awaiting_client' },
        // Booked by the client themselves: no concierge status.
        { id: 'i-self', tenantId: T1, propertyAddress: '2 Self Street', date: '2026-08-11', createdAt: new Date(now) },
    ]);

    await db.insert(schema.inspectionPeople).values([
        { id: 'p1', tenantId: T1, inspectionId: 'i-concierge', contactId: 'c-null', roleProfileId: CLIENT_ROLE, createdAt: new Date(now) },
        // The referring agent on the same concierge inspection: not a client,
        // so it must not be counted as one who was never asked.
        { id: 'p2', tenantId: T1, inspectionId: 'i-concierge', contactId: 'c-agent', roleProfileId: AGENT_ROLE, createdAt: new Date(now) },
        { id: 'p3', tenantId: T1, inspectionId: 'i-self', contactId: 'c-es', roleProfileId: CLIENT_ROLE, createdAt: new Date(now) },
    ]);
});

describe('multilingual demand signal — the documented queries', () => {
    it('publishes at least the four labelled queries', () => {
        expect([...blocks.keys()].sort()).toEqual(['A', 'B', 'C', 'D']);
    });

    it('carries the agent-booked undercount inside every query, so a copy-paste cannot lose it', () => {
        for (const [label, sql] of blocks) {
            expect(sql, `Query ${label} must state the undercount in its own comment header`)
                .toMatch(/Undercount:/);
        }
    });

    it('A: counts stated languages, keeping "(not stated)" out of the English bucket', () => {
        // Archived and non-client rows are excluded; a stated `en` stands on
        // its own because it is an answer, not an absence. Both tenants are in
        // scope — this is the operator's whole-database view.
        // Compared as a set: `en` and `es-419` tie on count here, and SQLite
        // does not promise an order between tied rows.
        const byLanguage = Object.fromEntries(
            run('A').map((row) => [row.stated_language, row.contacts]),
        );
        expect(byLanguage).toEqual({ '(not stated)': 2, 'es-419': 1, en: 1 });
    });

    it('B: reports the ratio the decision rule tests, and the answer rate that qualifies it', () => {
        // live_clients spans both tenants: this is the operator's whole-database
        // view, and query D is the per-tenant split.
        expect(run('B')).toEqual([
            { live_clients: 4, stated: 2, stated_non_english: 1 },
        ]);
    });

    it('C: sizes the blind spot — clients booked for them, never asked', () => {
        // c-null only. c-es was on a self-booked inspection; c-agent is on the
        // concierge one but is not a client.
        expect(run('C')).toEqual([{ agent_booked_clients: 1 }]);
    });

    it('D: separates tenants, and exposes the created_at clustering that marks seed data', () => {
        const rows = run('D');
        expect(rows).toEqual([
            {
                tenant_id: T1,
                live_clients: 3,
                stated: 2,
                first_created_ms: expect.any(Number),
                last_created_ms: expect.any(Number),
                distinct_days: 3,
            },
            {
                tenant_id: T2,
                live_clients: 1,
                stated: 0,
                first_created_ms: expect.any(Number),
                last_created_ms: expect.any(Number),
                distinct_days: 1,
            },
        ]);
    });
});
