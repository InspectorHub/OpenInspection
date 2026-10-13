import { describe, it, expect, vi } from 'vitest';
import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import { revokeAllUserGrants } from '../../../server/lib/mcp/grants';

type Page = { items: { id: string }[]; cursor?: string };

/** A provider double that serves `pages` in order, keyed by the cursor handed back. */
function providerWith(pages: Page[]) {
  const listUserGrants = vi.fn(async (_userId: string, opts?: { cursor?: string }) => {
    const idx = opts?.cursor ? Number(opts.cursor) : 0;
    return pages[idx] ?? { items: [] };
  });
  const revokeGrant = vi.fn(async () => undefined);
  return { oauth: { listUserGrants, revokeGrant } as unknown as OAuthHelpers, listUserGrants, revokeGrant };
}

describe('revokeAllUserGrants', () => {
  it('single page: revokes every grant with one list call', async () => {
    const { oauth, listUserGrants, revokeGrant } = providerWith([{ items: [{ id: 'g1' }, { id: 'g2' }] }]);
    await revokeAllUserGrants(oauth, 'u1');
    expect(listUserGrants).toHaveBeenCalledTimes(1);
    expect(revokeGrant.mock.calls.map((c) => c as unknown[])).toEqual([['g1', 'u1'], ['g2', 'u1']]);
  });

  it('two pages: follows the cursor and revokes grants from both pages', async () => {
    const { oauth, listUserGrants, revokeGrant } = providerWith([
      { items: [{ id: 'g1' }], cursor: '1' },
      { items: [{ id: 'g2' }] },
    ]);
    await revokeAllUserGrants(oauth, 'u1');
    expect(listUserGrants).toHaveBeenCalledTimes(2);
    expect(listUserGrants.mock.calls[1]?.[1]).toEqual({ cursor: '1' });
    expect(revokeGrant.mock.calls.map((c) => (c as unknown[])[0]).sort()).toEqual(['g1', 'g2']);
  });
});
