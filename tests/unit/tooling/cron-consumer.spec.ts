/**
 * Contract for the cron queue consumer.
 *
 * Each queue message is its own Worker invocation with its own CPU budget —
 * that is the entire mechanism the free-tier fix rests on. These cases pin the
 * three behaviours that decide whether the mechanism holds up: a job with more
 * work re-enqueues itself rather than looping, the self-continuation is
 * bounded, and a message that can never succeed is dropped rather than retried
 * a hundred times against a free-tier queue quota.
 */
import { describe, it, expect, vi } from 'vitest';
import { handleCronBatch, MAX_HOPS } from '../../../server/cron/consumer';

const msg = (body: unknown) => ({ body, ack: vi.fn(), retry: vi.fn() });

describe('handleCronBatch', () => {
    it('re-enqueues with the returned cursor when a job has more work', async () => {
        const send = vi.fn();
        const job = { key: 'orphan-media', run: vi.fn().mockResolvedValue({ processed: 50, nextCursor: 'abc' }) };
        const m = msg({ job: 'orphan-media', cursor: null, hop: 0 });
        await handleCronBatch({ CRON_QUEUE: { send } } as never, { messages: [m] } as never, [job] as never);
        expect(job.run).toHaveBeenCalledWith(expect.anything(), null);
        expect(send).toHaveBeenCalledWith({ job: 'orphan-media', cursor: 'abc', hop: 1 });
        expect(m.ack).toHaveBeenCalled();
    });

    it('stops re-enqueueing at the hop guard instead of looping forever', async () => {
        const send = vi.fn();
        // A job whose nextCursor never goes null — the shape a paging bug takes.
        const job = { key: 'orphan-media', run: vi.fn().mockResolvedValue({ processed: 1, nextCursor: 'same' }) };
        const m = msg({ job: 'orphan-media', cursor: 'same', hop: MAX_HOPS });
        await handleCronBatch({ CRON_QUEUE: { send } } as never, { messages: [m] } as never, [job] as never);
        expect(send, 'a job at the hop ceiling must not re-enqueue').not.toHaveBeenCalled();
        expect(m.ack).toHaveBeenCalled();
    });

    it('acks and does not retry an unknown job key', async () => {
        const send = vi.fn();
        const m = msg({ job: 'a-job-that-was-renamed', cursor: null, hop: 0 });
        await handleCronBatch({ CRON_QUEUE: { send } } as never, { messages: [m] } as never, [] as never);
        // Retrying would burn the queue quota on a message that can never
        // succeed. Ack and log instead.
        expect(m.retry).not.toHaveBeenCalled();
        expect(m.ack).toHaveBeenCalled();
    });

    it('retries a message whose job threw, so a transient D1 error is not lost', async () => {
        const job = { key: 'orphan-media', run: vi.fn().mockRejectedValue(new Error('D1 timeout')) };
        const m = msg({ job: 'orphan-media', cursor: null, hop: 0 });
        await handleCronBatch({ CRON_QUEUE: { send: vi.fn() } } as never, { messages: [m] } as never, [job] as never);
        expect(m.retry).toHaveBeenCalled();
        expect(m.ack).not.toHaveBeenCalled();
    });

    it('persists the cursor so a sweep cut off by the hop guard resumes next tick', async () => {
        const kv = { get: vi.fn(), put: vi.fn(), delete: vi.fn() };
        const job = { key: 'orphan-media', run: vi.fn().mockResolvedValue({ processed: 50, nextCursor: 'abc' }) };
        const m = msg({ job: 'orphan-media', cursor: null, hop: 0 });
        await handleCronBatch(
            { CRON_QUEUE: { send: vi.fn() }, TENANT_CACHE: kv } as never,
            { messages: [m] } as never, [job] as never,
        );
        expect(kv.put).toHaveBeenCalledWith('cron:cursor:orphan-media', 'abc', expect.anything());
    });

    it('clears the cursor when the sweep completes, so the next pass starts at the top', async () => {
        // Without this, a finished sweep's stale cursor is handed back to the
        // dispatcher forever and the sweep never sees the first page again.
        const kv = { get: vi.fn(), put: vi.fn(), delete: vi.fn() };
        const job = { key: 'orphan-media', run: vi.fn().mockResolvedValue({ processed: 3, nextCursor: null }) };
        const m = msg({ job: 'orphan-media', cursor: 'page-9', hop: 4 });
        await handleCronBatch(
            { CRON_QUEUE: { send: vi.fn() }, TENANT_CACHE: kv } as never,
            { messages: [m] } as never, [job] as never,
        );
        expect(kv.delete).toHaveBeenCalledWith('cron:cursor:orphan-media');
        expect(kv.put).not.toHaveBeenCalled();
    });

    it('runs a job from the cursor the message carries, not from the start', async () => {
        // The positive control for the paging contract: a resumed sweep that
        // silently restarted from the beginning would still ack, still
        // re-enqueue, and never finish — and every assertion above would pass.
        const job = { key: 'orphan-media', run: vi.fn().mockResolvedValue({ processed: 3, nextCursor: null }) };
        const m = msg({ job: 'orphan-media', cursor: 'page-7', hop: 2 });
        await handleCronBatch({ CRON_QUEUE: { send: vi.fn() } } as never, { messages: [m] } as never, [job] as never);
        expect(job.run).toHaveBeenCalledWith(expect.anything(), 'page-7');
    });
});
