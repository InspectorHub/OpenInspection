/**
 * Design System 0520 subsystem C phase 1 task 1.3 — role-alias shim.
 *
 * Verifies the bidirectional 'inspector' ↔ 'lead' alias so that
 * subsystem-C-aware allow-lists ('lead') still accept legacy tokens
 * carrying 'inspector', and pre-spec routes (allowedRoles: 'inspector')
 * accept new tokens carrying 'lead'.
 */
import { describe, it, expect } from 'vitest';
import { normaliseRole, ROLE_ALIASES, requireRole } from '../../server/lib/middleware/rbac';

describe('normaliseRole', () => {
    it('aliases inspector → lead', () => {
        expect(normaliseRole('inspector')).toBe('lead');
    });

    it('passes through other roles unchanged', () => {
        expect(normaliseRole('owner')).toBe('owner');
        expect(normaliseRole('admin')).toBe('admin');
        expect(normaliseRole('lead')).toBe('lead');
        expect(normaliseRole('specialist')).toBe('specialist');
        expect(normaliseRole('apprentice')).toBe('apprentice');
        expect(normaliseRole('office')).toBe('office');
        expect(normaliseRole('agent')).toBe('agent');
    });

    it('passes through unknown values verbatim', () => {
        expect(normaliseRole('bogus')).toBe('bogus');
    });
});

describe('ROLE_ALIASES contract', () => {
    it('only maps inspector → lead today (pre-launch single rename)', () => {
        expect(ROLE_ALIASES).toEqual({ inspector: 'lead' });
    });
});

// Build a minimal Hono-like context stub for the requireRole tests.
function makeCtx(role: string) {
    const store: Record<string, unknown> = { userRole: role };
    return {
        get: (k: string) => store[k],
        set: (k: string, v: unknown) => { store[k] = v; },
    };
}

describe('requireRole alias acceptance', () => {
    it('allowedRoles=[lead] accepts inspector-carrying token', async () => {
        const guard = requireRole(['lead']);
        const ctx = makeCtx('inspector');
        let nextCalled = false;
        await guard(ctx as never, async () => { nextCalled = true; });
        expect(nextCalled).toBe(true);
    });

    it('allowedRoles=[inspector] accepts lead-carrying token', async () => {
        const guard = requireRole(['inspector']);
        const ctx = makeCtx('lead');
        let nextCalled = false;
        await guard(ctx as never, async () => { nextCalled = true; });
        expect(nextCalled).toBe(true);
    });

    it('allowedRoles=[admin] rejects inspector', async () => {
        const guard = requireRole(['admin']);
        const ctx = makeCtx('inspector');
        await expect(guard(ctx as never, async () => {})).rejects.toThrow(/requires one of/i);
    });

    it('missing role 401s', async () => {
        const guard = requireRole(['lead']);
        const ctx = { get: () => undefined, set: () => {} };
        await expect(guard(ctx as never, async () => {})).rejects.toThrow(/no role/i);
    });
});
