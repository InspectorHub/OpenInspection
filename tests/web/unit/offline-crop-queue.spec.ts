import { describe, it, expect, vi } from 'vitest';
import { OfflineQueue } from '~/lib/offline/offline-queue';
import { createMemoryQueueStorage } from '~/lib/offline/queue-storage.memory';
import type { ReplayTransport } from '~/lib/offline/offline-queue';

const CROP = { aspect: 'free', orientation: 'landscape', x: 0, y: 0, width: 100, height: 80 } as const;

describe('offline crop queue', () => {
  it('enqueues a baked crop and replays it through submitCrop on reconnect', async () => {
    const storage = createMemoryQueueStorage();
    const submitCrop = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const transport: ReplayTransport = {
      submitWrite: vi.fn(),
      submitPhoto: vi.fn(),
      submitCrop,
    };
    const q = new OfflineQueue(storage, transport);

    await q.enqueueCrop({
      inspectionId: 'insp-1',
      itemId: 'item-1',
      photoIndex: 0,
      blob: new Blob([new Uint8Array(8)], { type: 'image/jpeg' }),
      crop: CROP,
      sectionId: undefined,
      enqueuedAt: Date.now(),
    });
    expect((await storage.counts()).pending).toBe(1);

    const result = await q.replay();
    expect(submitCrop).toHaveBeenCalledTimes(1);
    expect(submitCrop.mock.calls[0][0]).toMatchObject({ kind: 'crop', itemId: 'item-1', photoIndex: 0 });
    expect(result.synced).toBe(1);
    expect((await storage.counts()).pending).toBe(0);
  });

  it('keeps the crop entry pending when the transport throws (offline)', async () => {
    const storage = createMemoryQueueStorage();
    const transport: ReplayTransport = {
      submitWrite: vi.fn(),
      submitPhoto: vi.fn(),
      submitCrop: vi.fn().mockRejectedValue(new Error('offline')),
    };
    const q = new OfflineQueue(storage, transport);
    await q.enqueueCrop({
      inspectionId: 'insp-1', itemId: 'item-1', photoIndex: 0,
      blob: new Blob([new Uint8Array(8)]), crop: CROP, sectionId: undefined, enqueuedAt: Date.now(),
    });
    await q.replay();
    expect((await storage.counts()).pending).toBe(1); // still queued, attempts unchanged
  });
});
