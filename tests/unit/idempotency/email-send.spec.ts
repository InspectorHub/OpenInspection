/**
 * M1 — outbound email is the first consumer of the idempotency store.
 *
 * A duplicate send cannot be recalled, so "the provider was called once" is
 * asserted directly against a counting provider rather than inferred from a
 * return value. Metering is asserted alongside it: a replayed send that still
 * bills is the same bug wearing a different hat.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import { EmailService } from '../../../server/services/email.service';
import { buildEmailDedupe } from '../../../server/lib/email/dedupe';
import { idempotencyKeys } from '../../../server/lib/db/schema';

let db: ReturnType<typeof createTestDb>['db'];

function countingProvider() {
    const state = { calls: 0 };
    return {
        state,
        provider: {
            async sendEmail() {
                state.calls++;
                return { ok: true as const };
            },
        },
    };
}

function buildService(tenantId: string) {
    const { state, provider } = countingProvider();
    const metered = { calls: 0 };
    const service = new EmailService(
        'test-api-key',
        'from@example.com',
        'TestApp',
        undefined,
        undefined,
        { record: async () => { metered.calls++; } },
        provider as never,
        undefined,
        undefined,
        undefined,
        buildEmailDedupe(db as never, tenantId),
    );
    return { service, sent: state, metered };
}

const send = (service: EmailService, key: string, subject = 'Report ready') =>
    service.sendEmail(['client@example.com'], subject, '<p>hi</p>', undefined, { idempotencyKey: key });

describe('email send idempotency', () => {
    beforeEach(async () => {
        const t = createTestDb();
        await setupSchema(t.sqlite);
        db = t.db;
    });

    it('the same email sent twice under one key reaches the provider ONCE', async () => {
        const { service, sent } = buildService('t1');
        await send(service, 'k1');
        await send(service, 'k1');
        expect(sent.calls).toBe(1);
    });

    it('does not meter the replayed send', async () => {
        const { service, metered } = buildService('t1');
        await send(service, 'k1');
        await send(service, 'k1');
        expect(metered.calls).toBe(1);
    });

    it('sends again when the key is new', async () => {
        const { service, sent } = buildService('t1');
        await send(service, 'k1');
        await send(service, 'k2');
        expect(sent.calls).toBe(2);
    });

    it('scopes the key to the tenant — the same key for two tenants sends twice', async () => {
        const a = buildService('t1');
        const b = buildService('t2');
        await send(a.service, 'shared-key');
        await send(b.service, 'shared-key');
        expect(a.sent.calls).toBe(1);
        expect(b.sent.calls).toBe(1);

        const rows = await db.select().from(idempotencyKeys);
        expect(rows).toHaveLength(2);
        expect(rows.map(r => r.tenantId).sort()).toEqual(['t1', 't2']);
    });

    it('releases the key when delivery fails, so the retry actually sends', async () => {
        let calls = 0;
        const failing = {
            async sendEmail() {
                calls++;
                return calls === 1 ? { ok: false as const, error: 'boom' } : { ok: true as const };
            },
        };
        const service = new EmailService(
            'test-api-key', 'from@example.com', 'TestApp',
            undefined, undefined, undefined,
            failing as never,
            undefined, undefined, undefined,
            buildEmailDedupe(db as never, 't1'),
        );
        await expect(send(service, 'k1')).rejects.toThrow();
        await send(service, 'k1');
        expect(calls).toBe(2);
    });
});
