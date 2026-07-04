import { describe, it, expect } from 'vitest';
import { resolveRenderAccess } from '../../../server/api/public-report';
import { signRenderToken } from '../../../server/lib/render-token';

const SECRET = 's';

describe('resolveRenderAccess', () => {
  it('returns null when render param absent', async () => {
    expect(await resolveRenderAccess(undefined, 'insp-1', SECRET)).toBeNull();
  });
  it('returns null when token is for a different inspection', async () => {
    const tok = await signRenderToken('insp-OTHER', SECRET);
    expect(await resolveRenderAccess(tok, 'insp-1', SECRET)).toBeNull();
  });
  it('returns the inspectionId when the token matches', async () => {
    const tok = await signRenderToken('insp-1', SECRET);
    expect(await resolveRenderAccess(tok, 'insp-1', SECRET)).toEqual({ inspectionId: 'insp-1' });
  });
});

describe('photo route reuses resolveRenderAccess', () => {
  it('photo route reuses resolveRenderAccess: valid token resolves to its inspectionId', async () => {
    const { signRenderToken } = await import('../../../server/lib/render-token');
    const { resolveRenderAccess } = await import('../../../server/api/public-report');
    const tok = await signRenderToken('insp-1', 's');
    expect(await resolveRenderAccess(tok, 'insp-1', 's')).toEqual({ inspectionId: 'insp-1' });
  });
});
