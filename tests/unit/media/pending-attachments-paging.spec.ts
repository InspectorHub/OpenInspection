/**
 * Paging contract for the abandoned `_pending` attachment cleanup.
 *
 * This sweep walked the ENTIRE R2 bucket every five minutes. A prefix cannot
 * fix it — `_pending` sits mid-key, after the tenant id — so the only bound
 * available is on how much of the listing one invocation walks, with R2's own
 * cursor carried across invocations.
 */
import { describe, it, expect, vi } from 'vitest';
import { cleanupPendingAttachments } from '../../../server/lib/media/pending-attachments';

const NOW = Date.parse('2026-08-22T00:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

/** An R2 double serving a fixed number of truncated pages, then a final one. */
function makeR2(totalPages: number, objectsFor: (page: number) => { key: string; uploaded: Date }[] = () => []) {
    const seen: (string | undefined)[] = [];
    return {
        seen,
        list: vi.fn(async (opts: { cursor?: string }) => {
            seen.push(opts.cursor);
            const page = opts.cursor ? Number(opts.cursor.replace('c', '')) : 0;
            const truncated = page < totalPages - 1;
            return {
                objects: objectsFor(page),
                truncated,
                ...(truncated ? { cursor: `c${page + 1}` } : {}),
            };
        }),
        delete: vi.fn(async () => undefined),
    };
}

describe('cleanupPendingAttachments paging', () => {
    it('walks at most `pages` list pages and hands back R2s cursor', async () => {
        const r2 = makeR2(20);
        const result = await cleanupPendingAttachments(r2 as unknown as R2Bucket, NOW, { pages: 5, cursor: null });
        expect(r2.list, 'the bucket walk must be bounded per invocation').toHaveBeenCalledTimes(5);
        expect(result.nextCursor, 'an interrupted walk must say where to resume').toBe('c5');
    });

    it('resumes from the cursor it was given rather than from the start', async () => {
        const r2 = makeR2(20);
        await cleanupPendingAttachments(r2 as unknown as R2Bucket, NOW, { pages: 2, cursor: 'c7' });
        expect(r2.seen).toEqual(['c7', 'c8']);
    });

    it('returns a null cursor once the listing is exhausted', async () => {
        const r2 = makeR2(2);
        const result = await cleanupPendingAttachments(r2 as unknown as R2Bucket, NOW, { pages: 5, cursor: null });
        expect(r2.list).toHaveBeenCalledTimes(2);
        expect(result.nextCursor).toBeNull();
    });

    it('still deletes the aged _pending keys and nothing else', async () => {
        // The positive control. Every assertion above is satisfied by a sweep
        // that deletes nothing at all.
        const r2 = makeR2(1, () => [
            { key: 't1/messages/_pending/old.jpg', uploaded: new Date(NOW - 2 * DAY) },
            { key: 't1/messages/_pending/fresh.jpg', uploaded: new Date(NOW - 60_000) },
            { key: 't1/i1/attached.jpg', uploaded: new Date(NOW - 2 * DAY) },
        ]);
        const result = await cleanupPendingAttachments(r2 as unknown as R2Bucket, NOW, { pages: 5, cursor: null });
        expect(result.deleted).toBe(1);
        expect(r2.delete).toHaveBeenCalledTimes(1);
        expect(r2.delete).toHaveBeenCalledWith('t1/messages/_pending/old.jpg');
    });
});
