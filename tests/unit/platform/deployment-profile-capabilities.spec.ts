import { describe, it, expect } from 'vitest';
import {
    getDeploymentProfile,
    SAAS_PROFILE,
    STANDALONE_PROFILE,
} from '../../../server/lib/deployment-profile';

describe('DeploymentProfile capability surface', () => {
    it('standalone owns its own video backend and has no managed compliance or company-scoped MCP', () => {
        expect(STANDALONE_PROFILE.videoBackendManaged).toBe(false);
        expect(STANDALONE_PROFILE.hasManagedCompliance).toBe(false);
        expect(STANDALONE_PROFILE.mcpApiRoute).toBe('/mcp');
        expect(STANDALONE_PROFILE.hasContentMarketplace).toBe(false);
        // Owns its tenant row outright — there is no platform storing another
        // copy — and mounts no machine-to-machine surface, because there is
        // nobody on the other end to authenticate.
        expect(STANDALONE_PROFILE.tenantRecordOwnedByPortal).toBe(false);
        expect(STANDALONE_PROFILE.hasPortalIntegrationApi).toBe(false);
    });

    it('saas plan-manages the video backend and mounts MCP under the company prefix', () => {
        expect(SAAS_PROFILE.videoBackendManaged).toBe(true);
        expect(SAAS_PROFILE.hasManagedCompliance).toBe(true);
        expect(SAAS_PROFILE.mcpApiRoute).toBe('/company/');
        expect(SAAS_PROFILE.hasContentMarketplace).toBe(true);
        // Portal is the system of record for the tenant row and the M2M surface
        // exists for it to talk through. These two replaced the last two
        // `env.APP_MODE` comparisons outside the seam.
        expect(SAAS_PROFILE.tenantRecordOwnedByPortal).toBe(true);
        expect(SAAS_PROFILE.hasPortalIntegrationApi).toBe(true);
    });
});

describe('getDeploymentProfile — derivations', () => {
    it('strips one trailing slash off the portal base and uses it for BOTH derived urls', () => {
        const p = getDeploymentProfile({ APP_MODE: 'saas', PORTAL_API_URL: 'https://portal.example/' });
        expect(p.loginRedirectBase).toBe('https://portal.example');
        expect(p.billingPortalUrl).toBe('https://portal.example');
    });

    it('leaves both urls null in saas when no portal base is configured', () => {
        const p = getDeploymentProfile({ APP_MODE: 'saas' });
        expect(p.loginRedirectBase).toBeNull();
        expect(p.billingPortalUrl).toBeNull();
    });

    it('has no portal base in standalone even if the var is somehow present', () => {
        const p = getDeploymentProfile({ APP_MODE: 'standalone', PORTAL_API_URL: 'https://portal.example' });
        expect(p.mode).toBe('standalone');
        expect(p.loginRedirectBase).toBeNull();
    });

    it('treats an absent or unrecognised APP_MODE as standalone', () => {
        expect(getDeploymentProfile({}).mode).toBe('standalone');
        expect(getDeploymentProfile({ APP_MODE: 'SAAS' }).mode).toBe('standalone');
    });

    // The reason Task 3-7 can call this at all: an env that carries only what
    // the function reads is enough. Before OI #308 the parameter was AppEnv,
    // and every caller holding a narrower env either cast or reimplemented.
    it('accepts any env carrying only the three fields it reads', () => {
        const workerEnvShaped: { APP_MODE?: string } = { APP_MODE: 'saas' };
        expect(getDeploymentProfile(workerEnvShaped).mode).toBe('saas');
    });
});
