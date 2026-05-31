import { describe, it, expect } from 'vitest';
import { classifyJwtPayload } from '../../src/lib/auth/jwt-claims';
import type { JWTPayload } from 'hono/utils/jwt/types';

describe('classifyJwtPayload — A1', () => {
    it('classifies role=agent (no tenantId claim) as kind=agent', () => {
        const payload: JWTPayload = {
            sub: 'agent-1',
            role: 'agent',
            iat: 1735000000,
            exp: 1735086400,
        };
        const result = classifyJwtPayload(payload);
        expect(result?.kind).toBe('agent');
        if (result?.kind === 'agent') {
            expect(result.userId).toBe('agent-1');
        }
    });

    it('classifies role=agent even when an old client accidentally sends tenantId', () => {
        // Defensive: even if someone smuggles a tenantId claim alongside role=agent,
        // we ignore it. Agent JWTs are scoped via agent_tenant_links, not via JWT.
        const payload: JWTPayload = {
            sub: 'agent-2',
            role: 'agent',
            tenantId: 't-bogus',
            iat: 1735000000,
        };
        const result = classifyJwtPayload(payload);
        expect(result?.kind).toBe('agent');
    });

    it('classifies inspector with tenantId claim as kind=tenant', () => {
        const payload: JWTPayload = {
            sub: 'inspector-1',
            role: 'inspector',
            'custom:tenantId': 't-acme',
            'custom:userRole': 'inspector',
            iat: 1735000000,
        };
        const result = classifyJwtPayload(payload);
        expect(result?.kind).toBe('tenant');
        if (result?.kind === 'tenant') {
            expect(result.userId).toBe('inspector-1');
            expect(result.tenantId).toBe('t-acme');
            expect(result.role).toBe('inspector');
        }
    });

    it('reads tenantId from the legacy `tenantId` claim shape', () => {
        const payload: JWTPayload = {
            sub: 'owner-1',
            role: 'owner',
            tenantId: 't-acme',
            iat: 1735000000,
        };
        const result = classifyJwtPayload(payload);
        expect(result?.kind).toBe('tenant');
        if (result?.kind === 'tenant') {
            expect(result.tenantId).toBe('t-acme');
            expect(result.role).toBe('owner');
        }
    });

    it('classifies inspector role without tenantId as kind=unscoped (legacy tolerance)', () => {
        const payload: JWTPayload = {
            sub: 'inspector-2',
            role: 'inspector',
            iat: 1735000000,
        };
        const result = classifyJwtPayload(payload);
        expect(result?.kind).toBe('unscoped');
    });

    it('returns null when sub is missing', () => {
        const payload: JWTPayload = {
            role: 'agent',
            iat: 1735000000,
        };
        expect(classifyJwtPayload(payload)).toBeNull();
    });

    it('returns null when role is missing on a tenant token', () => {
        const payload: JWTPayload = {
            sub: 'user-1',
            iat: 1735000000,
        };
        expect(classifyJwtPayload(payload)).toBeNull();
    });
});
