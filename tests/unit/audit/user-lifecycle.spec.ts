import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Source-level, deliberately. A behavioural test would need the whole tenant
 * middleware chain stood up, and `createRoutesStub` does not run middleware —
 * an auth-shaped test built on it is green for the wrong reason. What must not
 * regress here is that the write EXISTS at the site; that the write works is
 * covered by the shared writeAuditLog specs.
 */
const src = (p: string) => readFileSync(p, 'utf8');

describe('user lifecycle is audited', () => {
    it('invite writes user.invite', () => {
        expect(src('server/api/team.ts')).toMatch(/auditFromContext\([^)]*'user\.invite'/s);
    });

    it('team.ts audits at all — it had zero calls before this change', () => {
        expect((src('server/api/team.ts').match(/auditFromContext/g) ?? []).length).toBeGreaterThan(0);
    });

    it('join writes user.join', () => {
        expect(src('server/api/auth.ts')).toMatch(/'user\.join'/);
    });

    /**
     * Deliberately NOT `auditFromContext`. The JWT middleware returns early for
     * `/join` (it is reached without a session), so `c.get('tenantId')` is
     * undefined inside that handler. `auditFromContext` would pass undefined
     * into a NOT NULL column, the insert would throw, and `writeAuditLog`
     * swallows write failures by contract — the audit would silently never
     * happen while the source read as if it did. The tenant has to come from
     * the joined user.
     */
    it('the join audit takes its tenant from the joined user, not from the context', () => {
        const s = src('server/api/auth.ts');
        const call = /writeAuditLog\(\{[^]*?'user\.join'[^]*?\}\)/.exec(s)?.[0] ?? '';
        expect(call, 'no writeAuditLog call carrying user.join').not.toBe('');
        expect(call).toMatch(/tenantId:\s*user\.tenantId/);
        expect(s, 'auditFromContext cannot serve /join').not.toMatch(/auditFromContext\([^)]*'user\.join'/s);
    });

    it('a password change is audited, not only replicated', () => {
        const s = src('server/api/auth.ts');
        expect(s).toMatch(/auditFromContext\([^)]*'user\.password_change'/s);
    });

    it('the outbox event is still emitted — the audit row is an addition, not a replacement', () => {
        expect(src('server/services/auth.service.ts')).toContain('user.password_changed');
    });
});
