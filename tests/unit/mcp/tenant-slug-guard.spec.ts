/**
 * Focused unit tests for the spec §6 saas company-slug tenant guard.
 *
 * Tests the combined guard decision (companySlugFromMcpPath +
 * assertCompanySlugMatches) without standing up the OAuthProvider or the
 * InspectorMcp Durable Object — the decision logic is pure and fully
 * exercisable from the extracted helpers.
 */
import { describe, it, expect } from 'vitest';
import {
    assertCompanySlugMatches,
    companySlugFromMcpPath,
} from '../../../server/lib/mcp/identity-bridge';
import type { McpProps } from '../../../server/durable-objects/inspector-mcp';

function makeProps(tenantSlug: string): McpProps {
    return {
        userId: 'u-1',
        tenantId: 't-1',
        tenantSlug,
        role: 'admin',
        scopes: ['read:inspections'],
    };
}

describe('saas tenant-slug guard decision', () => {
    it('rejects when URL slug differs from props.tenantSlug (403 path)', () => {
        const urlSlug = companySlugFromMcpPath('/company/acme/mcp');
        expect(urlSlug).not.toBeNull();
        const allowed = assertCompanySlugMatches(urlSlug!, makeProps('other'));
        expect(allowed).toBe(false);
    });

    it('allows when URL slug matches props.tenantSlug (pass-through path)', () => {
        const urlSlug = companySlugFromMcpPath('/company/acme/mcp');
        expect(urlSlug).not.toBeNull();
        const allowed = assertCompanySlugMatches(urlSlug!, makeProps('acme'));
        expect(allowed).toBe(true);
    });

    it('allows when no slug is present in the path (standalone or non-company URL)', () => {
        const urlSlug = companySlugFromMcpPath('/mcp');
        // No slug → guard is not applicable; delegate unchanged.
        expect(urlSlug).toBeNull();
    });

    it('rejects on case mismatch (slug comparison is case-sensitive)', () => {
        const urlSlug = companySlugFromMcpPath('/company/Acme/mcp');
        expect(urlSlug).not.toBeNull();
        const allowed = assertCompanySlugMatches(urlSlug!, makeProps('acme'));
        expect(allowed).toBe(false);
    });
});
