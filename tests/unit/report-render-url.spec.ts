import { describe, it, expect } from 'vitest';
import { verifyRenderToken } from '../../server/lib/render-token';
import { buildRenderReportUrl } from '../../server/lib/public-urls';

describe('buildRenderReportUrl', () => {
  it('appends a valid render token for the inspection', async () => {
    const url = await buildRenderReportUrl('app.example.com', 'acme', 'insp-1', 'secret');
    expect(url.startsWith('https://app.example.com/report-view/acme/insp-1')).toBe(true);
    const render = new URL(url).searchParams.get('render')!;
    expect(await verifyRenderToken(render, 'secret')).toEqual({ inspectionId: 'insp-1' });
  });
});
