import { describe, it, expect } from 'vitest';
import { parseCmdEnvelope, isKnownCmd } from '../../../server/lib/sync-events/cmd-envelope';

const valid = {
    specversion: '1.0', id: 'e1', type: 'io.inspectorhub.cmd.tenant.sync_quota',
    source: 'portal', time: '2026-06-05T00:00:00.000Z',
    dataschema: 'cmd-tenant-sync-quota/v1', tenantseq: 3,
    data: { tenantId: 't1', maxUsers: 10 },
};

describe('cmd envelope consumer contract (A-21)', () => {
    it('parses a valid envelope (object or JSON string)', () => {
        expect(parseCmdEnvelope(valid)?.tenantseq).toBe(3);
        expect(parseCmdEnvelope(JSON.stringify(valid))?.id).toBe('e1');
    });
    it('rejects an envelope missing tenantseq', () => {
        const { tenantseq: _drop, ...rest } = valid;
        expect(parseCmdEnvelope(rest)).toBeNull();
    });
    it('isKnownCmd gates on type AND dataschema version', () => {
        expect(isKnownCmd('io.inspectorhub.cmd.tenant.update', 'cmd-tenant-update/v1')).toBe(true);
        expect(isKnownCmd('io.inspectorhub.cmd.tenant.update', 'cmd-tenant-update/v2')).toBe(false);
        expect(isKnownCmd('io.inspectorhub.cmd.future.thing', 'cmd-future-thing/v1')).toBe(false);
    });
});
