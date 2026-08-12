import { describe, it, expect, vi } from 'vitest';
import { runAutomationTemplateBackfillOnce } from '../../../server/services/message-template-backfill';
import { MockKV } from '../mocks';

// Covers the fix for the finding on 5d6034f9: the cross-tenant
// backfillAllTenants sweep must run from the cron path, latched to run
// exactly once via a TENANT_CACHE marker — not behind a per-tenant
// owner/manager-gated HTTP route (which let any single tenant's owner
// trigger writes across every OTHER tenant). These specs pin the guard
// behavior in isolation from the sweep itself (already covered by
// backfill-all-tenants.spec.ts), via an injected `sweep` fn.
describe('runAutomationTemplateBackfillOnce', () => {
    it('runs the sweep once and skips on a later call because the marker is present', async () => {
        const kv = new MockKV() as unknown as KVNamespace;
        const sweep = vi.fn().mockResolvedValue({ tenants: 2, created: 3 });

        const first = await runAutomationTemplateBackfillOnce({} as D1Database, kv, sweep);
        expect(first).toEqual({ ran: true, result: { tenants: 2, created: 3 } });
        expect(sweep).toHaveBeenCalledTimes(1);

        // A later cron tick — marker is now present, so the cross-tenant
        // sweep must NOT run again.
        const second = await runAutomationTemplateBackfillOnce({} as D1Database, kv, sweep);
        expect(second).toEqual({ ran: false });
        expect(sweep).toHaveBeenCalledTimes(1);
    });

    it('leaves the marker unset when the sweep throws, so the next tick retries', async () => {
        const kv = new MockKV() as unknown as KVNamespace;
        const sweep = vi.fn().mockRejectedValueOnce(new Error('boom'));

        await expect(runAutomationTemplateBackfillOnce({} as D1Database, kv, sweep)).rejects.toThrow('boom');

        // If the marker had been written despite the throw, this second call
        // would skip (ran: false) and never touch the sweep again. It must
        // instead retry, proving the failed run left no marker behind.
        const succeeded = vi.fn().mockResolvedValue({ tenants: 1, created: 1 });
        const retry = await runAutomationTemplateBackfillOnce({} as D1Database, kv, succeeded);
        expect(retry).toEqual({ ran: true, result: { tenants: 1, created: 1 } });
        expect(succeeded).toHaveBeenCalledTimes(1);
    });

    it('skips without throwing when TENANT_CACHE is not bound', async () => {
        const sweep = vi.fn();
        const outcome = await runAutomationTemplateBackfillOnce({} as D1Database, undefined, sweep);
        expect(outcome).toEqual({ ran: false });
        expect(sweep).not.toHaveBeenCalled();
    });
});
