import { describe, it, expect } from 'vitest';
import { signMagicLink, verifyMagicLink, signPortalSession, verifyPortalSession } from '../../../server/lib/portal-session';

const SECRET = 'test-jwt-secret';
describe('portal magic-link + session (HMAC, no DB)', () => {
  it('round-trips a magic-link token within expiry', async () => {
    const tok = await signMagicLink(SECRET, 'a@x.com', 900); // 15 min
    expect(await verifyMagicLink(SECRET, tok)).toEqual({ email: 'a@x.com' });
  });
  it('rejects an expired magic-link', async () => {
    const tok = await signMagicLink(SECRET, 'a@x.com', -1);
    expect(await verifyMagicLink(SECRET, tok)).toBeNull();
  });
  it('rejects a tampered magic-link', async () => {
    const tok = await signMagicLink(SECRET, 'a@x.com', 900);
    expect(await verifyMagicLink(SECRET, tok.slice(0, -2) + 'xx')).toBeNull();
  });
  it('round-trips a session cookie', async () => {
    const c = await signPortalSession(SECRET, 'a@x.com', 2592000); // 30d
    expect(await verifyPortalSession(SECRET, c)).toEqual({ email: 'a@x.com' });
  });
  it('rejects tampered/expired session', async () => {
    expect(await verifyPortalSession(SECRET, 'garbage.sig')).toBeNull();
    const exp = await signPortalSession(SECRET, 'a@x.com', -1);
    expect(await verifyPortalSession(SECRET, exp)).toBeNull();
  });
  it('does not accept a magic-link token as a session cookie or vice versa (typ discriminator)', async () => {
    const ml = await signMagicLink(SECRET, 'a@x.com', 900);
    expect(await verifyPortalSession(SECRET, ml)).toBeNull();
    const sess = await signPortalSession(SECRET, 'a@x.com', 2592000);
    expect(await verifyMagicLink(SECRET, sess)).toBeNull();
  });
});
