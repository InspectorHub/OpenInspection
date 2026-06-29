import { describe, it, expect } from 'vitest';
import { internalJwtPayload, assertTenantMatches } from '../../../server/lib/mcp/identity-bridge';
import type { McpProps } from '../../../server/durable-objects/inspector-mcp';

const sample: McpProps = {
    userId: 'u-123',
    tenantId: 't-456',
    tenantSlug: 'acme-inspections',
    role: 'inspector',
    scopes: ['read:inspections'],
};

describe('internalJwtPayload', () => {
    it('emits sub from userId', () => {
        expect(internalJwtPayload(sample).sub).toBe('u-123');
    });

    it('emits custom:userRole (not custom:role or role) from props.role', () => {
        const p = internalJwtPayload(sample);
        expect(p['custom:userRole']).toBe('inspector');
        // Brief correction verified: jwt-claims.ts reads 'custom:userRole', NOT 'custom:role'
        expect(p['custom:role']).toBeUndefined();
        expect(p['role']).toBeUndefined();
    });

    it('emits custom:tenantId from tenantId', () => {
        expect(internalJwtPayload(sample)['custom:tenantId']).toBe('t-456');
    });

    it('includes iat as a recent Unix epoch (seconds)', () => {
        const before = Math.floor(Date.now() / 1000);
        const p = internalJwtPayload(sample);
        const after = Math.floor(Date.now() / 1000);
        expect(typeof p['iat']).toBe('number');
        expect(p['iat'] as number).toBeGreaterThanOrEqual(before);
        expect(p['iat'] as number).toBeLessThanOrEqual(after);
    });

    it('does not leak tenantSlug or scopes into the claim set', () => {
        const p = internalJwtPayload(sample);
        expect(p['tenantSlug']).toBeUndefined();
        expect(p['scopes']).toBeUndefined();
    });

    it('uses props values, not static placeholders', () => {
        const other: McpProps = {
            userId: 'u-999',
            tenantId: 't-888',
            tenantSlug: 'beta',
            role: 'manager',
            scopes: [],
        };
        const p = internalJwtPayload(other);
        expect(p.sub).toBe('u-999');
        expect(p['custom:userRole']).toBe('manager');
        expect(p['custom:tenantId']).toBe('t-888');
    });
});

describe('assertTenantMatches', () => {
    it('does not throw when tenantId matches', () => {
        expect(() => assertTenantMatches('t-456', sample)).not.toThrow();
    });

    it('throws "tenant mismatch" when tenantId differs', () => {
        expect(() => assertTenantMatches('t-OTHER', sample)).toThrow('tenant mismatch');
    });

    it('is case-sensitive', () => {
        expect(() => assertTenantMatches('T-456', sample)).toThrow('tenant mismatch');
    });
});
