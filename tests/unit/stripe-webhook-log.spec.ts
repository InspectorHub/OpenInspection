import { describe, it, expect } from 'vitest';
import { appendWebhookLogEntry, readWebhookLog, stripeWebhookLogKey } from '../../server/lib/stripe-webhook-log';

function makeKv() {
    const store = new Map<string, string>();
    return {
        store,
        get: async (k: string, _o?: unknown) => {
            const v = store.get(k);
            return v === undefined ? null : JSON.parse(v);
        },
        put: async (k: string, v: string) => { store.set(k, v); },
    } as unknown as KVNamespace & { store: Map<string, string> };
}

describe('stripe webhook rolling log', () => {
    it('prepends entries and caps at 20', async () => {
        const kv = makeKv();
        for (let i = 0; i < 25; i++) {
            await appendWebhookLogEntry(kv, 't1', { eventType: `e${i}`, result: 'received' });
        }
        const log = await readWebhookLog(kv, 't1');
        expect(log).toHaveLength(20);
        expect(log[0].eventType).toBe('e24');           // newest first
        expect(log[0].ts).toMatch(/^\d{4}-/);            // ISO stamp
    });

    it('stores metadata only and never throws without KV', async () => {
        await expect(appendWebhookLogEntry(undefined, 't1', { eventType: 'x', result: 'processed' })).resolves.toBeUndefined();
        expect(await readWebhookLog(undefined, 't1')).toEqual([]);
        void stripeWebhookLogKey('t1');
    });

    it('survives a corrupt KV value (returns [], next append rebuilds)', async () => {
        const kv = makeKv();
        kv.store.set(stripeWebhookLogKey('t1'), 'not-json');
        expect(await readWebhookLog(kv, 't1')).toEqual([]);
        await appendWebhookLogEntry(kv, 't1', { eventType: 'y', result: 'processed' });
        expect((await readWebhookLog(kv, 't1'))).toHaveLength(1);
    });
});

describe('signature_failed eviction defense', () => {
    it('sub-caps unverified failures so verified rows always survive', async () => {
        const kv = makeKv();
        // 10 genuine verified entries…
        for (let i = 0; i < 10; i++) {
            await appendWebhookLogEntry(kv, 't1', { eventType: `ok${i}`, result: 'processed' });
        }
        // …then an attacker spams 30 garbage POSTs (pre-verification failures).
        for (let i = 0; i < 30; i++) {
            await appendWebhookLogEntry(kv, 't1', { eventType: 'unknown', result: 'signature_failed' });
        }
        const log = await readWebhookLog(kv, 't1');
        const failed = log.filter((e) => e.result === 'signature_failed');
        const processed = log.filter((e) => e.result === 'processed');
        expect(failed.length).toBeLessThanOrEqual(5);
        expect(processed).toHaveLength(10); // none evicted
        expect(log[0].result).toBe('signature_failed'); // newest still first
    });
});
