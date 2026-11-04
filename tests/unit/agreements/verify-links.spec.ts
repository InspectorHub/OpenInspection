/**
 * B10: the public verifier's links cost what they hand out. The key and document links read only the key fingerprints of the chain
 * (not every audit row, and no signature is checked), and all three public verify routes are counted per network.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { app } from '../../../server/index';
import { makeExecutionContext } from '../helpers/exec-ctx';
import { SigningKeyService } from '../../../server/services/signing-key.service';
import { createHarness, TENANT_ID, type Harness } from '../helpers/tenant-email-harness';
import { ENV1, seedEnvelopes, watchDb } from '../helpers/verify-export-kit';

describe('the public verify links', () => {
    let h: Harness;

    const get = async (path: string, ip = '203.0.113.9'): Promise<Response> => {
        const exec = makeExecutionContext({ label: 'verify-links' });
        const res = await app.request(path, { redirect: 'manual', headers: { 'CF-Connecting-IP': ip } }, h.env, exec.ctx);
        await exec.settle();
        return res;
    };

    beforeEach(async () => {
        h = await createHarness('standalone');
        await seedEnvelopes(h);
        await SigningKeyService.fromEnv(h.env.DB, h.env).ensureKeypair(TENANT_ID);
    });
    afterEach(() => h.close());

    it('the key link hands out the key and the document link redirects, without reading any audit payload', async () => {
        const watch = watchDb(h);
        const key = await get(`/api/public/verify/${ENV1}/public-key`);
        const doc = await get(`/api/public/verify/${ENV1}/document`);
        watch.restore();
        expect(key.status).toBe(200);
        expect(await key.text()).toContain('BEGIN PUBLIC KEY');
        expect(doc.status).toBe(302);
        expect(doc.headers.get('location')).toContain(`/m2m/agreement-render/`);
        const auditReads = watch.log.filter((q) => /from "esign_audit_logs"/i.test(q));
        expect(auditReads.length).toBeGreaterThan(0);
        // Only the distinct key fingerprints are read: never the payloads, hashes or signatures the full verification needs.
        for (const q of auditReads) expect(q, q).not.toMatch(/payload_json|"signature"|"prev_hash"/);
    });

    it('the verification route still reads and checks the whole chain (the price the verifier page pays)', async () => {
        const watch = watchDb(h);
        const res = await get(`/api/public/verify/${ENV1}`);
        watch.restore();
        expect(res.status).toBe(200);
        expect(watch.log.some((q) => /from "esign_audit_logs"/i.test(q) && /payload_json/.test(q))).toBe(true);
    });

    it('all three are counted per network: over the limit they answer 429 before reading anything', async () => {
        const refuse = { limit: async () => ({ success: false }) };
        Object.assign(h.env, { RATE_LIMITER: refuse });
        const watch = watchDb(h);
        const statuses = [
            (await get(`/api/public/verify/${ENV1}`)).status,
            (await get(`/api/public/verify/${ENV1}/public-key`)).status,
            (await get(`/api/public/verify/${ENV1}/document`)).status,
        ];
        watch.restore();
        expect(statuses).toEqual([429, 429, 429]);
        expect(watch.log.some((q) => /esign_audit_logs|agreement_requests/.test(q))).toBe(false);
        // Control: with room left the same requests are answered.
        Object.assign(h.env, { RATE_LIMITER: { limit: async () => ({ success: true }) } });
        expect((await get(`/api/public/verify/${ENV1}/public-key`)).status).toBe(200);
    });
});
