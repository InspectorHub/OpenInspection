// `cmd.report.correct` through the real consumer pipeline.
//
// The APPLIER is stubbed here on purpose. Its real behaviour — what gets
// published, what gets refused, what gets rethrown — has coverage against a
// real database in tests/unit/reports/report-correction-command.spec.ts, and
// repeating it here would only make this file slower without asking anything
// new. What only workerd can answer is the seam: dedup, the stale guard, and
// whether the answer that reaches the queue still says which of the three
// endings happened.
//
// The two seam properties this file exists for:
//
//   THE STALE GUARD MUST NOT DROP IT. A correction shares `tenants.cmd_seq`
//   with every unrelated tenant command. Left guarded, a quota sync that merely
//   OVERTOOK the correction in the queue would drop it silently, with no reply,
//   leaving the request open until its statutory deadline ran out. Nothing about
//   a rectification is superseded by a seat-count change.
//
//   DEDUP MUST HOLD IT TO ONCE. Unlike the two subject commands, this one is not
//   idempotent: a second run publishes a SECOND amendment on a report that was
//   already corrected. The exemption above removes one guard, so the assertion
//   that the other one still bites is not optional.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { applyCmdEnvelope } from '../../server/portal/cmd-consumer';
import correctCmd from '../fixtures/cmd-events/cmd-report-correct-v1.json';
import { TENANTS_TEST_DDL } from '../helpers/inline-ddl';

/** What the stubbed applier will answer, and how many times it was asked.
 *  Rebuilt per test — a shared object is how one case's refusal leaks into
 *  every case after it. */
let applierResult: Record<string, unknown>;
const applierCalls: Array<Record<string, unknown>> = [];

vi.mock('../../server/portal/apply-report-correction', () => ({
    applyReportCorrection: async (
        _d1: unknown, _secret: string, data: Record<string, unknown>, opts: Record<string, unknown>,
    ) => {
        applierCalls.push({ data, opts });
        return applierResult;
    },
}));

const b = env as unknown as { DB: D1Database };
const kvStub = { delete: async () => {} } as unknown as KVNamespace;
const SECRET = 'test-encryption-secret-key';

const CORRECTED = {
    outcome: 'corrected',
    inspectionId: correctCmd.data.inspectionId,
    field: 'propertyAddress',
    versionNumber: 2,
    supersedes: 1,
};

async function seedSchema(): Promise<void> {
    await b.DB.exec(
        TENANTS_TEST_DDL,
    );
    await b.DB.exec('CREATE TABLE IF NOT EXISTS processed_cmd_events (event_id TEXT PRIMARY KEY, cmd_type TEXT NOT NULL, processed_at INTEGER NOT NULL);');
    await b.DB.exec('CREATE TABLE IF NOT EXISTS parked_cmd_events (id TEXT PRIMARY KEY, envelope TEXT NOT NULL, reason TEXT NOT NULL, received_at INTEGER NOT NULL);');
    await b.DB.exec(
        "CREATE TABLE IF NOT EXISTS sync_outbox (id TEXT PRIMARY KEY, event_type TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, last_tried_at INTEGER, last_error TEXT);",
    );
}

async function clearTables(): Promise<void> {
    for (const t of ['processed_cmd_events', 'parked_cmd_events', 'sync_outbox', 'tenants']) {
        await b.DB.exec(`DELETE FROM ${t};`);
    }
    await b.DB.prepare("INSERT INTO tenants (id, slug, created_at) VALUES ('fixture-tenant-4', 'ws-f4', 1)").run();
    applierResult = { ...CORRECTED };
    applierCalls.length = 0;
}

function fakeQueue() {
    const sent: Array<Record<string, unknown>> = [];
    return {
        sent,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        queue: { send: async (e: unknown) => { sent.push(e as Record<string, unknown>); } } as any,
    };
}

const apply = (q: ReturnType<typeof fakeQueue>, envelope: unknown = correctCmd) =>
    applyCmdEnvelope(b.DB, kvStub, envelope, q.queue, undefined, undefined, undefined, SECRET);

describe('cmd consumer — report correction', () => {
    beforeAll(seedSchema);
    beforeEach(clearTables);

    it('applies, and the reply names the version published and the one it supersedes', async () => {
        const q = fakeQueue();
        expect(await apply(q)).toBe('applied');
        expect(q.sent).toHaveLength(1);
        expect(q.sent[0]).toMatchObject({
            type: 'io.inspectorhub.reply.report.corrected',
            source: 'core',
            dataschema: 'reply-report-corrected/v1',
            data: {
                tenantId: 'fixture-tenant-4',
                correlationId: correctCmd.id,
                replyto: correctCmd.replyto,
                outcome: 'corrected',
                versionNumber: 2,
                supersedes: 1,
            },
        });
    });

    it('hands the applier the authorising record, not a sender-chosen identifier', async () => {
        // The command payload carries no `correctedBy`; the amendment's
        // attribution comes from `replyto` and from nowhere else.
        await apply(fakeQueue());
        expect(applierCalls).toHaveLength(1);
        expect(applierCalls[0]!['opts']).toEqual({ correctedBy: correctCmd.replyto });
        expect(applierCalls[0]!['data']).not.toHaveProperty('correctedBy');
    });

    it('sends a REFUSAL back as an answer, carrying no version numbers', async () => {
        applierResult = {
            outcome: 'refused',
            inspectionId: correctCmd.data.inspectionId,
            field: 'propertyAddress',
            reason: 'Inspection not found',
        };
        const q = fakeQueue();
        expect(await apply(q)).toBe('applied');
        const data = (q.sent[0] as { data: Record<string, unknown> }).data;
        expect(data['outcome']).toBe('refused');
        expect(data['reason']).toBe('Inspection not found');
        // The positive case above proves a reply CAN carry these. Here their
        // absence is the guarantee: a refusal has nothing a reader could
        // mistake for a completion.
        expect('versionNumber' in data).toBe(false);
        expect('supersedes' in data).toBe(false);
    });

    it('is NOT dropped by the stale guard when an unrelated command overtook it', async () => {
        // The high-water mark is already past this command's sequence — which
        // for tenant state means "superseded, drop it". A rectification is not
        // tenant state, and dropping it would leave a statutory clock running
        // with no reply and no trace.
        await b.DB.prepare("UPDATE tenants SET applied_cmd_seq = 999 WHERE id = 'fixture-tenant-4'").run();
        const q = fakeQueue();
        expect(await apply(q)).toBe('applied');
        expect(applierCalls).toHaveLength(1);
        expect(q.sent).toHaveLength(1);
    });

    it('does not advance the high-water mark backwards past a newer command', async () => {
        await b.DB.prepare("UPDATE tenants SET applied_cmd_seq = 999 WHERE id = 'fixture-tenant-4'").run();
        await apply(fakeQueue());
        const row = await b.DB.prepare("SELECT applied_cmd_seq AS s FROM tenants WHERE id = 'fixture-tenant-4'").first<{ s: number }>();
        expect(row?.s).toBe(999);
    });

    it('runs the correction ONCE on a redelivery — a second amendment must not be published', async () => {
        const first = fakeQueue();
        expect(await apply(first)).toBe('applied');
        const second = fakeQueue();
        expect(await apply(second)).toBe('duplicate');
        // The seam is at-least-once and this command is not idempotent, so the
        // count is the assertion, not the return value.
        expect(applierCalls).toHaveLength(1);
        // And the duplicate does not re-emit: unlike `reply.tenant.updated`,
        // this payload is not reconstructable from the envelope, so a
        // re-emitted reply would have to invent the version numbers.
        expect(second.sent).toHaveLength(0);
    });

    it('refuses to run without the secret the amendment must be signed with', async () => {
        // Throws rather than replying: this is a fact about OUR configuration,
        // and answering a person's rectification request with it would be a
        // final answer to the wrong question. Retry, then a visible dead command.
        await expect(
            applyCmdEnvelope(b.DB, kvStub, correctCmd, fakeQueue().queue, undefined, undefined, undefined, undefined),
        ).rejects.toThrow(/encryption secret/i);
        expect(applierCalls).toHaveLength(0);
    });

    it('parks a correction command at a version this build cannot apply', async () => {
        const future = { ...correctCmd, id: 'evt-future', dataschema: 'cmd-report-correct/v2' };
        expect(await apply(fakeQueue(), future)).toBe('parked');
        expect(applierCalls).toHaveLength(0);
    });
});
