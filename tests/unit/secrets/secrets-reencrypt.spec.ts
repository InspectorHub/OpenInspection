import { describe, it, expect } from 'vitest';
import { encryptSecrets, sealSecrets, openSecrets } from '../../../server/lib/config-crypto';
import { reencryptAllTenantSecrets } from '../../../server/lib/secrets-reencrypt';

const CUR = 'new-secret';
const PREV = 'old-secret';

describe('reencryptAllTenantSecrets', () => {
    it('migrates legacy, rewraps previous-KEK rows, skips current, reports failures', async () => {
        const legacy = await encryptSecrets({ A: '1' }, PREV);             // legacy under OLD
        const underPrev = await sealSecrets({ B: '2' }, 't2', PREV);       // v2 under OLD KEK
        const current = await sealSecrets({ C: '3' }, 't3', CUR);          // already current
        const rows = [
            { tenantId: 't1', blob: legacy, dekEnc: null },
            { tenantId: 't2', blob: underPrev.blob, dekEnc: underPrev.dekEnc },
            { tenantId: 't3', blob: current.blob, dekEnc: current.dekEnc },
            { tenantId: 't4', blob: 'v2:garbage:garbage', dekEnc: 'k1:garbage:garbage' },
        ];
        const updates: Record<string, { blob?: string; dekEnc?: string }> = {};
        const busted: string[] = [];
        const report = await reencryptAllTenantSecrets({
            listRows: async () => rows,
            updateRow: async (tenantId, patch) => { updates[tenantId] = patch; },
            bustCache: async (tenantId) => { busted.push(tenantId); },
        }, CUR, PREV);

        expect(report).toMatchObject({ migrated: 1, rewrapped: 1, alreadyCurrent: 1 });
        expect(report.failed).toHaveLength(1);
        expect(report.failed[0].tenantId).toBe('t4');
        // t1 migrated to envelope and decrypts under CURRENT only
        expect(await openSecrets(updates.t1.blob!, updates.t1.dekEnc!, 't1', CUR)).toEqual({ A: '1' });
        // t2 dek re-wrapped (blob untouched), decrypts under CURRENT
        expect(updates.t2.blob).toBeUndefined();
        expect(await openSecrets(underPrev.blob, updates.t2.dekEnc!, 't2', CUR)).toEqual({ B: '2' });
        // cache busted ONLY for changed rows
        expect(busted.sort()).toEqual(['t1', 't2']);
    });

    it('is idempotent — a second run reports everything alreadyCurrent', async () => {
        const sealed = await sealSecrets({ A: '1' }, 't1', CUR);
        const report = await reencryptAllTenantSecrets({
            listRows: async () => [{ tenantId: 't1', blob: sealed.blob, dekEnc: sealed.dekEnc }],
            updateRow: async () => { throw new Error('must not write'); },
            bustCache: async () => { throw new Error('must not bust'); },
        }, CUR, PREV);
        expect(report).toMatchObject({ migrated: 0, rewrapped: 0, alreadyCurrent: 1, failed: [] });
    });

    it('legacy row with no previous secret fails cleanly when current cannot decrypt it', async () => {
        const legacy = await encryptSecrets({ A: '1' }, PREV);
        const report = await reencryptAllTenantSecrets({
            listRows: async () => [{ tenantId: 't1', blob: legacy, dekEnc: null }],
            updateRow: async () => {},
            bustCache: async () => {},
        }, CUR /* no previous */);
        expect(report.failed).toHaveLength(1);
        expect(report.failed[0].tenantId).toBe('t1');
    });
});
