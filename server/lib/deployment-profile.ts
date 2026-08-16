/**
 * Deployment profile capability surface.
 *
 * Centralises every mode-specific decision the worker makes into 2
 * immutable `DeploymentProfile` constants. Read a capability; never
 * branch on `env.APP_MODE` yourself.
 *
 * Three sanctioned readers, by what you are holding:
 *
 *   Hono handler / middleware ............ c.var.profile.<capability>
 *   only an env (RR loader or action,
 *   cron, Workflow, queue consumer) ...... getDeploymentProfile(env).<capability>
 *   client component ..................... isSaas / deployment.mode from
 *                                          the session context
 *
 * The middle row is why `getDeploymentProfile` takes `ProfileEnv` rather
 * than `AppEnv`: before OI #308 it demanded an env most callers did not
 * have, and nine sites wrote their own branch instead. Enforced by
 * tests/unit/sync/portal-isolation.spec.ts.
 *
 * Silo deconvergence (2026-05-29): silo + shared SaaS collapsed into
 * a single SAAS_PROFILE. The remaining "silo vs shared" distinction
 * is a per-tenant property (tenants.deploymentMode) that signals
 * which D1 backend to query — not a deployment-wide topology.
 *
 * See `docs/superpowers/specs/2026-05-20-deployment-modes-design.md`
 * (historical), `docs/superpowers/plans/2026-05-29-silo-deconvergence.md`,
 * and `docs/superpowers/specs/2026-08-10-oi-deployment-mode-branching-design.md`.
 */

/**
 * Exactly the env fields this module reads — nothing else.
 *
 * Deliberately NOT `AppEnv`. Every env shape in the worker satisfies this
 * structurally: the Hono `AppEnv`, the RR `WorkerEnv`, the cron `ScheduledEnv`,
 * and the `EmailServiceEnv` a Cloudflare Workflow supplies. Asking for the full
 * AppEnv is what pushed nine call sites into writing their own
 * `env.APP_MODE === 'saas'` instead of reading a capability (OI #308 §4-§5).
 */
export interface ProfileEnv {
    APP_MODE?: string;
    PORTAL_API_URL?: string;
    SINGLE_TENANT_ID?: string;
}

type DeploymentMode = 'standalone' | 'saas';

export interface DeploymentProfile {
    mode: DeploymentMode;

    fixedTenantId: string | null;

    hasBilling: boolean;
    hasSeatQuota: boolean;
    hasUsageQuota: boolean;
    billingPortalUrl: string | null;
    /** Base URL the browser is sent to for saas login-bounce + "Switch workspace".
     *  Derived from PORTAL_API_URL (trailing slash stripped); null in standalone. */
    loginRedirectBase: string | null;

    hasSetupWizard: boolean;

    aiDevMockFallback: boolean;

    /** Whether a platform-provided AI credential may ever be resolved for a
     *  tenant. False in standalone: there is no platform behind a self-hosted
     *  deploy, so the managed path is ABSENT rather than disabled-by-default.
     *  Read this instead of branching on APP_MODE — see the file header. */
    hasManagedAi: boolean;

    brandingSource: 'env' | 'tenant-config';

    /** Where the MCP OAuth surface mounts. SaaS serves per-workspace endpoints
     *  under /company/{slug}/mcp, so the provider takes the broad '/company/'
     *  prefix; standalone has one fixed '/mcp'. The company-slug guard applies
     *  exactly when this is '/company/' — derive it, do not re-test the mode. */
    mcpApiRoute: '/mcp' | '/company/';

    /** Whether the PLATFORM decides the video backend. True in saas (plan gate
     *  on tenants.tier/status); false in standalone, where the operator sets
     *  tenant_configs.videoMode themselves — which is why the self-host settings
     *  form exists at all and the saas one refuses to save. */
    videoBackendManaged: boolean;

    /** Whether a platform-operated compliance path (managed SMS provisioning —
     *  10DLC brand/campaign) exists for tenants. False in standalone: there is
     *  no platform to file on the operator's behalf, so the path is ABSENT
     *  rather than disabled. Distinct from hasManagedAi — different provider,
     *  different entitlement. */
    hasManagedCompliance: boolean;

    /** Whether the content marketplace SURFACE exists in this deployment. False
     *  in standalone: the catalogue is curated first-party and there is no path
     *  by which anything reaches it, so the browse route 404s rather than
     *  rendering an empty shelf. This is about the surface EXISTING, not about
     *  entitlement — the API handlers in `server/api/marketplace.ts` stay
     *  ungated in both modes (OI #293 reuses them). */
    hasContentMarketplace: boolean;

    /** Whether the PLATFORM supplies the Intuit app a tenant connects through.
     *  True in saas: one published app serves every tenant, and asking an
     *  inspection company to register their own on developer.intuit.com would
     *  be handing them a question none of our competitors ask. False in
     *  standalone — not as a downgrade, but because Intuit matches a redirect
     *  URI byte for byte and a self-hosted deploy answers on its own domain, so
     *  the platform's app CANNOT work there whatever we prefer.
     *
     *  This is what decides whether the credential form renders at all. Read it
     *  instead of branching on APP_MODE — see the file header. */
    qboAppManaged: boolean;
}

const FIXED_TENANT_FALLBACK = '00000000-0000-0000-0000-000000000000';

export const STANDALONE_PROFILE: DeploymentProfile = {
    mode: 'standalone',
    fixedTenantId: FIXED_TENANT_FALLBACK,
    hasBilling: false, hasSeatQuota: false, hasUsageQuota: false, billingPortalUrl: null,
    loginRedirectBase: null,
    hasSetupWizard: true,
    aiDevMockFallback: true,
    hasManagedAi: false,
    brandingSource: 'env',
    mcpApiRoute: '/mcp',
    videoBackendManaged: false,
    hasManagedCompliance: false,
    hasContentMarketplace: false,
    qboAppManaged: false,
};

export const SAAS_PROFILE: DeploymentProfile = {
    mode: 'saas',
    fixedTenantId: null,
    hasBilling: true, hasSeatQuota: true, hasUsageQuota: true, billingPortalUrl: null,
    loginRedirectBase: null,
    hasSetupWizard: false,
    aiDevMockFallback: false,
    hasManagedAi: true,
    brandingSource: 'tenant-config',
    mcpApiRoute: '/company/',
    videoBackendManaged: true,
    hasManagedCompliance: true,
    hasContentMarketplace: true,
    qboAppManaged: true,
};

/**
 * Resolve the active profile from request env. Pure function — same
 * env in, same profile out — so callers may memoise per-worker-
 * instance if desired.
 *
 * Precedence: APP_MODE=saas wins; standalone is the default. The
 * old SAAS_TOPOLOGY env var is no longer read.
 */
export function getDeploymentProfile(env: ProfileEnv): DeploymentProfile {
    if (env.APP_MODE === 'saas') {
        const base = env.PORTAL_API_URL ? env.PORTAL_API_URL.replace(/\/$/, '') : null;
        return { ...SAAS_PROFILE, billingPortalUrl: base, loginRedirectBase: base };
    }
    return { ...STANDALONE_PROFILE, fixedTenantId: env.SINGLE_TENANT_ID ?? FIXED_TENANT_FALLBACK };
}
