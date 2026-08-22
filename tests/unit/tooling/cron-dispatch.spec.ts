/**
 * Contract for the cron dispatcher.
 *
 * One invariant carries the whole free-tier fix: the cron invocation's CPU
 * budget pays for cheap due-checks and nothing else. If a job body ever runs on
 * the tick again, thirteen jobs are back inside one 10 ms budget and the bug is
 * back with them — so it is asserted here rather than left to review.
 */
import { describe, it, expect, vi } from 'vitest';
import { dispatchCron } from '../../../server/cron/dispatch';

const job = (key: string, dueCount: number) => ({
    key, label: key, trigger: '*/5 * * * *', modes: ['standalone', 'saas'], maxBatch: 50,
    probe: vi.fn().mockResolvedValue(dueCount),
    run: vi.fn(),
});

describe('dispatchCron', () => {
    it('enqueues only the jobs whose probe found work', async () => {
        const send = vi.fn();
        const busy = job('orphan-media', 7);
        const idle = job('agreement-expiry', 0);
        await dispatchCron({ cron: '*/5 * * * *' } as never, { CRON_QUEUE: { send } } as never, [busy, idle] as never);
        expect(send).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledWith({ job: 'orphan-media', cursor: null, hop: 0 });
    });

    it('never runs a job body on the cron invocation', async () => {
        // The whole refactor: the tick's CPU budget pays for probes only.
        const busy = job('orphan-media', 7);
        await dispatchCron({ cron: '*/5 * * * *' } as never, { CRON_QUEUE: { send: vi.fn() } } as never, [busy] as never);
        expect(busy.run).not.toHaveBeenCalled();
    });

    it('only probes jobs belonging to the cron expression that fired', async () => {
        const daily = { ...job('r2-usage', 5), trigger: '0 3 * * *' };
        const tick = job('agreement-expiry', 5);
        await dispatchCron({ cron: '*/5 * * * *' } as never, { CRON_QUEUE: { send: vi.fn() } } as never, [daily, tick] as never);
        expect(daily.probe, 'a daily job must not be probed by the 5-minute tick').not.toHaveBeenCalled();
        expect(tick.probe).toHaveBeenCalled();
    });

    it('dispatches the daily expression to its own job, and only that one', async () => {
        // Positive control for the case above: a filter that matched nothing
        // would also satisfy "the daily job was not probed by the tick".
        const send = vi.fn();
        const daily = { ...job('r2-usage', 5), trigger: '0 3 * * *' };
        const tick = job('agreement-expiry', 5);
        await dispatchCron({ cron: '0 3 * * *' } as never, { CRON_QUEUE: { send } } as never, [daily, tick] as never);
        expect(daily.probe).toHaveBeenCalled();
        expect(tick.probe).not.toHaveBeenCalled();
        expect(send).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledWith({ job: 'r2-usage', cursor: null, hop: 0 });
    });

    it('skips a job the deployment mode does not have', async () => {
        const send = vi.fn();
        const saasOnly = { ...job('portal-outbox', 9), modes: ['saas'] };
        // No APP_MODE => standalone.
        await dispatchCron({ cron: '*/5 * * * *' } as never, { CRON_QUEUE: { send } } as never, [saasOnly] as never);
        expect(saasOnly.probe).not.toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
    });

    it('a probe that throws does not stop the other jobs from being dispatched', async () => {
        const send = vi.fn();
        const broken = { ...job('qbo-cdc', 0), probe: vi.fn().mockRejectedValue(new Error('D1 down')) };
        const fine = job('agreement-expiry', 3);
        await dispatchCron({ cron: '*/5 * * * *' } as never, { CRON_QUEUE: { send } } as never, [broken, fine] as never);
        expect(send).toHaveBeenCalledWith({ job: 'agreement-expiry', cursor: null, hop: 0 });
    });

    it('resumes from a stored cursor rather than restarting a half-finished sweep', async () => {
        const send = vi.fn();
        const busy = job('orphan-media', 7);
        const env = { CRON_QUEUE: { send }, TENANT_CACHE: { get: vi.fn().mockResolvedValue('page-3'), put: vi.fn(), delete: vi.fn() } };
        await dispatchCron({ cron: '*/5 * * * *' } as never, env as never, [busy] as never);
        expect(send).toHaveBeenCalledWith({ job: 'orphan-media', cursor: 'page-3', hop: 0 });
    });
});
