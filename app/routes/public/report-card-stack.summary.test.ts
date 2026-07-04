// tests/web/unit/report-card-stack.summary.spec.ts
import { describe, it, expect } from 'vitest';
import { loader } from '../../../app/routes/public/report-card-stack';

function fakeCtx() {
  // Minimal context: createApi(context) will throw → loader catches → defaults returned.
  return {} as any;
}

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
