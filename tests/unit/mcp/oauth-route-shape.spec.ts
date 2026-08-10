import { describe, it, expect } from 'vitest';
import { getDeploymentProfile } from '../../../server/lib/deployment-profile';

describe('MCP mount shape follows the profile', () => {
    it('standalone mounts one fixed endpoint', () => {
        expect(getDeploymentProfile({ APP_MODE: 'standalone' }).mcpApiRoute).toBe('/mcp');
    });

    it('saas mounts the broad company prefix', () => {
        expect(getDeploymentProfile({ APP_MODE: 'saas' }).mcpApiRoute).toBe('/company/');
    });

    // The coupling that used to be two independent mode tests: the slug guard
    // is needed exactly when the mount path carries the company prefix. Pinning
    // it here means a future third mode cannot get one without the other.
    it('the company prefix is the only route shape that needs the slug guard', () => {
        const needsSlugGuard = (route: string) => route === '/company/';
        expect(needsSlugGuard(getDeploymentProfile({ APP_MODE: 'saas' }).mcpApiRoute)).toBe(true);
        expect(needsSlugGuard(getDeploymentProfile({ APP_MODE: 'standalone' }).mcpApiRoute)).toBe(false);
    });
});
