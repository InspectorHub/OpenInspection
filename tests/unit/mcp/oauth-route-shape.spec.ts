import { describe, it, expect } from 'vitest';
import { getDeploymentProfile } from '../../../server/lib/deployment-profile';

describe('MCP mount shape follows the profile', () => {
    it('standalone mounts one fixed endpoint', () => {
        expect(getDeploymentProfile({ APP_MODE: 'standalone' }).mcpApiRoute).toBe('/mcp');
    });

    it('saas mounts under the same /mcp prefix, per workspace', () => {
        expect(getDeploymentProfile({ APP_MODE: 'saas' }).mcpApiRoute).toBe('/mcp');
    });

    // The mount no longer differs by mode, so nothing can be derived from it.
    // What replaced that coupling: the slug guard fires on the PATH shape, so
    // a future third mode gets the guard for free the moment it puts a slug in
    // the URL — and cannot get a slug without it.
    it('never claims a namespace broader than /mcp', () => {
        for (const mode of ['saas', 'standalone']) {
            const route = getDeploymentProfile({ APP_MODE: mode }).mcpApiRoute;
            expect(route, `${mode} mount`).toBe('/mcp');
            expect(route.startsWith('/company'), `${mode} must not claim /company/*`).toBe(false);
        }
    });
});
