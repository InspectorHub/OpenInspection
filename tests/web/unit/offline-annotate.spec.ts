import { describe, it, expect, vi } from 'vitest';
import { createActionTransport } from '~/lib/offline/action-transport';
import type { QueuedPhoto } from '~/lib/offline/queue-storage';

describe('offline annotate replay', () => {
  it('submitPhoto posts replay-annotation with itemId/photoIndex/nodes for a derivative', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, apiStatus: 200 }), { status: 200 }));
    const transport = createActionTransport(fetchMock as never);
    const entry: QueuedPhoto = {
      seq: 1, kind: 'photo', inspectionId: 'insp-1', itemId: 'item-roof',
      name: 'annotated.png', blob: new Blob(['x'], { type: 'image/png' }),
      enqueuedAt: 0, attempts: 0, status: 'pending',
      derivative: { kind: 'annotation', photoIndex: 2, nodes: '[]', sectionId: 'sec-ext' },
    };
    const res = await transport.submitPhoto(entry);
    expect(res).toEqual({ ok: true, status: 200 });
    const body = fetchMock.mock.calls[0][1].body as FormData;
    expect(body.get('intent')).toBe('replay-annotation');
    expect(body.get('photoIndex')).toBe('2');
    expect(body.get('sectionId')).toBe('sec-ext');
    expect(body.get('image')).toBeInstanceOf(File);
  });

  it('a plain photo (no derivative) still posts replay-photo', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const transport = createActionTransport(fetchMock as never);
    await transport.submitPhoto({
      seq: 2, kind: 'photo', inspectionId: 'i', itemId: 'it', name: 'p.jpg',
      blob: new Blob(['y']), enqueuedAt: 0, attempts: 0, status: 'pending',
    });
    expect((fetchMock.mock.calls[0][1].body as FormData).get('intent')).toBe('replay-photo');
  });
});
