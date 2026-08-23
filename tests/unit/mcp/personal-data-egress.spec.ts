import { describe, it, expect } from 'vitest';
import snapshot from '../../../server/lib/mcp/openapi-snapshot.json';
import { selectTools } from '../../../server/lib/mcp/tools';

interface Entry { operationId: string; tier: string; scopes: string[]; tag: string }
const ALL = snapshot as unknown as Entry[];

/**
 * The subject-access export is not an MCP tool, and must not become one.
 *
 * It once was, at `extended` tier, on a deployment whose config sets
 * `MCP_EXTENDED_TOOLS: "true"` — so an OAuth-authorised language model could
 * call it. At the time it star-selected the `users` row, which meant the
 * caller's password hash and their LIVE TOTP secret landed in a model context
 * in one call. The credential half is fixed at the source now
 * (`server/lib/compliance/account-export-manifest.ts`), and this file pins the
 * other half: the export stays off the tool surface regardless.
 *
 * `excluded` is the only tier the flag cannot re-enable, which is why it is the
 * one used — a flag-dependent answer would be one dashboard edit from untrue.
 */
describe('personal-data egress over MCP', () => {
    it('keeps the account export off the tool surface even with extended tools ON', () => {
        const granted = selectTools(ALL as never[], ['read:*', 'write:*'], { includeExtended: true });
        expect(granted.map((e) => (e as unknown as Entry).operationId)).not.toContain('exportMyAccount');
    });

    /**
     * Positive control. Without it, a `selectTools` that returned nothing —
     * a wrong scope string, a snapshot that failed to load, an inverted filter
     * — would satisfy the assertion above while proving nothing at all.
     */
    it('POSITIVE CONTROL — that same call does grant extended tools', () => {
        const granted = selectTools(ALL as never[], ['read:*', 'write:*'], { includeExtended: true });
        expect(granted.length).toBeGreaterThan(0);
        expect(granted.some((e) => (e as unknown as Entry).tier === 'extended')).toBe(true);
    });

    it('records the tier at source, so a snapshot regenerated from the routes keeps it', () => {
        const entry = ALL.find((e) => e.operationId === 'exportMyAccount');
        expect(entry, 'exportMyAccount is missing from the snapshot entirely').toBeTruthy();
        expect(entry!.tier).toBe('excluded');
    });
});
