import { mcpEnabled, oauthProviderEnabled } from '../mcp/flag';
import type { DeploymentProfile } from '../deployment-profile';

/**
 * Which deployment capabilities the browser is sent.
 *
 * An explicit allowlist, not a spread of the whole profile: it also carries
 * `fixedTenantId` and the portal URLs, which are the server's business.
 *
 * It is a NAMED function so a spec can assert on what ships. The list used to
 * be four fields written inline, and a capability that is not on it is not
 * merely undocumented in the client — it is UNREADABLE there. That is not a
 * hypothetical: `library-hub.tsx` and `CommandPalette.tsx` both gated the
 * marketplace on `branding.isSaas` while `marketplace.tsx` gated it on
 * `hasContentMarketplace`, and the reason was simply that the capability had
 * never been put on the wire. The wrong answer was the only reachable one.
 * (That capability is gone now — the marketplace exists in every deployment,
 * so there is no question left to ship. The lesson about the allowlist stands.)
 */
export function deploymentPayload(
    profile: DeploymentProfile,
    env: { MCP_ENABLED?: string; NATIVE_CLIENT_ENABLED?: string },
) {
    return {
        mode: profile.mode || 'standalone',
        hasBilling: profile.hasBilling || false,
        hasSeatQuota: profile.hasSeatQuota || false,
        mcpEnabled: mcpEnabled(env),
        // The OAuth provider is mounted for MCP or native clients, and the grant list
        // and revoke routes serve either. The Connected applications page keys off
        // this, not off `mcpEnabled`, which stays the MCP switch alone.
        connectedAppsEnabled: oauthProviderEnabled(env),
        videoBackendManaged: profile.videoBackendManaged || false,
        hasManagedCompliance: profile.hasManagedCompliance || false,
        // The BOOLEAN only, never the three import caps beside it on the
        // profile. Those are the grounds on which the server refuses; shipping
        // them would invite the browser to re-decide the same question, and two
        // implementations of one limit eventually disagree. The client shows
        // whatever sentence the server sent back with the refusal.
        hasAssistedMigration: profile.hasAssistedMigration || false,
    };
}
