import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loader } from '../../../app/routes/public/report-card-stack';

function fakeCtx() {
  // Bare context: getApiUrl() falls back to a real http://localhost:8788 base,
  // so the loader's brand/report fetches would otherwise hit the network.
  return {} as any;
}

beforeEach(() => {
  // initialFilter is derived purely from the request URL; the loader's
  // brand/report fetches are irrelevant to it. Stub fetch to fail fast so the
  // loader takes its graceful-default path hermetically — no real request.
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no API in unit test')));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('report-card-stack loader summary mode', () => {
  it('defaults initialFilter to "summary" when ?summary=1', async () => {
    const res: any = await loader({
      params: { tenant: 't', id: 'i' },
      request: new Request('https://x/report-view/t/i?summary=1'),
      context: fakeCtx(),
    } as any);
    expect(res.initialFilter).toBe('summary');
  });
  it('defaults initialFilter to "all" otherwise', async () => {
    const res: any = await loader({
      params: { tenant: 't', id: 'i' },
      request: new Request('https://x/report-view/t/i'),
      context: fakeCtx(),
    } as any);
    expect(res.initialFilter).toBe('all');
  });
});
