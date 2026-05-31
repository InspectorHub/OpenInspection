/**
 * JWT test helper â€?generates valid tokens for E2E tests.
 * Uses hono/jwt's sign() (already a project dependency).
 * No /src changes required.
 *
 * Dev secret must match the fallback in src/index.ts:
 *   'fallback_secret_for_local_dev'
 *
 * Usage in tests:
 *   import { makeToken } from './helpers/tokens';
 *   const token = await makeToken({ role: 'admin', tenantId: 'dev-tenant' });
 *   const res = await request.get('/api/...', { headers: { Authorization: `Bearer ${token}` } });
 */

import { sign } from 'hono/jwt';

const DEV_SECRET = process.env.JWT_SECRET ?? 'fallback_secret_for_local_dev';

export interface TokenPayload {
  role?: 'admin' | 'inspector' | 'viewer' | 'agent';
  tenantId?: string;
  sub?: string;
  exp?: number; // unix seconds
}

export async function makeToken({
  role = 'admin',
  tenantId = 'dev-tenant',
  sub = 'test-user-id',
  exp,
}: TokenPayload = {}): Promise<string> {
  const payload: Record<string, unknown> = {
    sub,
    'custom:tenantId': tenantId,
    'custom:userRole': role,
    role,
    iat: Math.floor(Date.now() / 1000),
    exp: exp ?? Math.floor(Date.now() / 1000) + 3600, // 1 hour
  };
  return sign(payload, DEV_SECRET, 'HS256');
}
