import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderPdfToR2 } from '../../server/workflows/sign-completion-workflow';
import type { AppEnv } from '../../server/types/hono';

/**
 * Browser Rendering rasterizes ANY page it can load — including HTTP error
 * pages. A 404 "Not found" renders to a valid-looking PDF and quickAction()
 * reports only the BR *service* status, never the target page's status. So
 * renderPdfToR2 MUST preflight the render URL and refuse to render an error
 * page into a legally-meaningful artifact (production incident: a broken render
 * URL produced a "Not found" signed.pdf that was emailed + zipped to a client).
 */
describe('renderPdfToR2 preflight', () => {
  afterEach(() => vi.unstubAllGlobals());

  function fakeEnv(quickAction: ReturnType<typeof vi.fn>, put: ReturnType<typeof vi.fn>): AppEnv {
    return {
      PHOTOS: { put } as unknown,
      BROWSER: { quickAction } as unknown,
    } as unknown as AppEnv;
  }

  it('throws and never invokes Browser Rendering when the render target is a 404', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Not found', { status: 404 })));
    const quickAction = vi.fn();
    const put = vi.fn();
    const env = fakeEnv(quickAction, put);

    await expect(
      renderPdfToR2(env, { renderUrl: 'https://app.example/m2m/agreement-render//abc', r2Key: 'k' }),
    ).rejects.toThrow(/HTTP 404/);

    expect(quickAction).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it('renders + stores when the render target returns 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>real agreement</html>', { status: 200 })));
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
    const quickAction = vi.fn(async () => ({ ok: true, arrayBuffer: async () => pdfBytes.buffer }));
    const put = vi.fn(async () => undefined);
    const env = fakeEnv(quickAction, put);

    const meta = await renderPdfToR2(env, { renderUrl: 'https://app.example/m2m/agreement-render/acme/abc', r2Key: 'k' });

    expect(quickAction).toHaveBeenCalledOnce();
    expect(put).toHaveBeenCalledOnce();
    expect(meta.r2Key).toBe('k');
    expect(meta.sizeBytes).toBe(4);
  });
});
