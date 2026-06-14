// tests/unit/render-token.spec.ts
import { describe, it, expect } from 'vitest';
import { signRenderToken, verifyRenderToken } from '../../server/lib/render-token';

const SECRET = 'test-secret-abc';

describe('render-token', () => {
  it('round-trips a valid token to its inspectionId', async () => {
    const tok = await signRenderToken('insp-1', SECRET, 60_000);
    expect(await verifyRenderToken(tok, SECRET)).toEqual({ inspectionId: 'insp-1' });
  });

  it('rejects a tampered body', async () => {
    const tok = await signRenderToken('insp-1', SECRET, 60_000);
    const [, sig] = tok.split('.');
    const forged = `${Buffer.from(JSON.stringify({ i: 'insp-evil', e: Date.now() + 60_000 })).toString('base64url')}.${sig}`;
    expect(await verifyRenderToken(forged, SECRET)).toBeNull();
  });

  it('rejects a token signed with a different secret', async () => {
    const tok = await signRenderToken('insp-1', SECRET, 60_000);
    expect(await verifyRenderToken(tok, 'other-secret')).toBeNull();
  });

  it('rejects an expired token', async () => {
    const tok = await signRenderToken('insp-1', SECRET, -1);
    expect(await verifyRenderToken(tok, SECRET)).toBeNull();
  });

  it('rejects malformed input', async () => {
    expect(await verifyRenderToken('', SECRET)).toBeNull();
    expect(await verifyRenderToken('nodot', SECRET)).toBeNull();
  });
});
