// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: string[] = [];
const respond = (status: number, body: unknown = {}) => ({ ok: status < 400, status, json: async () => body });

vi.mock('~/lib/api-client.server', () => ({
  createApi: () => ({
    publicReport: {
      verify: {
        report: { ':token': { $get: async () => { calls.push('verify/report'); return respond(404); } } },
        // The envelope route is rate limited and keyed by envelope id: a printed token must never be sent to it.
        ':envelopeId': { $get: async () => { calls.push('verify/:envelopeId'); return respond(404); } },
      },
      'verify-by-token': { ':token': { $get: async ({ param }: { param: { token: string } }) => {
        calls.push('verify-by-token');
        return param.token === 'printed-token' ? respond(200, { data: { envelopeId: 'env-1' } }) : respond(404);
      } } },
    },
  }),
}));
vi.mock('~/lib/tenant-brand.server', () => ({ resolveTenantBrand: async () => ({}) }));

import { loader } from '~/routes/public/v.$token';

describe('the verification link loader', () => {
  beforeEach(() => { calls.length = 0; });

  it('resolves a token printed on a signed agreement through the token route, never through the envelope route', async () => {
    const result = await loader({ params: { token: 'printed-token' }, context: {} } as never);
    expect(result).toEqual({ kind: 'agreement', envelopeId: 'env-1' });
    expect(calls).toEqual(['verify/report', 'verify-by-token']);
  });

  it('an unknown token is not found, again without touching the envelope route', async () => {
    const result = await loader({ params: { token: 'nothing' }, context: {} } as never);
    expect(result).toEqual({ kind: 'not_found' });
    expect(calls).not.toContain('verify/:envelopeId');
  });
});
