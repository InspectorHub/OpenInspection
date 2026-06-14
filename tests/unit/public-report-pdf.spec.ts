import { describe, it, expect } from 'vitest';
import { resolvePortalAccess } from '../../server/lib/public-access';

describe('client pdf download auth contract', () => {
  it('rejects when token does not match the inspection', async () => {
    const svc = { resolveToken: async () => ({ inspectionId: 'OTHER', tenantId: 't', role: 'client' as const, recipientEmail: 'a@b.c', revokedAt: null, expiresAt: null }) };
    expect(await resolvePortalAccess(svc as any, 'tok', 'insp-1')).toBeNull();
  });
  it('grants when token matches', async () => {
    const svc = { resolveToken: async () => ({ inspectionId: 'insp-1', tenantId: 't', role: 'client' as const, recipientEmail: 'a@b.c', revokedAt: null, expiresAt: null }) };
    expect((await resolvePortalAccess(svc as any, 'tok', 'insp-1'))?.tenantId).toBe('t');
  });
});
