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
 * See `docs/reference/deployment-modes.md`.
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
    /**
     * Per-deployment overrides for the import caps below.
     *
     * They exist because the defaults are a guess about somebody else's
     * hosting plan. An operator who knows their own per-request budget can say
     * so here without editing source; an operator who does not gets the mode's
     * default. Strings because environment variables are strings.
     */
    IMPORT_MAX_CSV_BYTES?: string;
    IMPORT_MAX_VENDOR_EXPORT_BYTES?: string;
    IMPORT_MAX_ROWS?: string;
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

    // `hasContentMarketplace` was removed here, and the removal is the fix
    // rather than a tidy-up. It answered two questions at once — "may this
    // deployment BROWSE and INSTALL catalogue entries" and "may it PUBLISH
    // them" — whose standalone answers are opposite, and it answered both with
    // the publishing one. Its comment justified the standalone 404 with "there
    // is no path by which anything reaches the catalogue", which was never
    // true: `server/services/starter-content/seed-marketplace-libraries.ts`
    // upserts the catalogue from this repository's own fixtures, and its caller
    // `server/api/admin/admin-content-install.ts` is gated on role, not on
    // mode. So a self-hosted deployment always had a populated catalogue and a
    // 404 in front of it.
    //
    // Consumption is now unconditional, which leaves nothing mode-specific to
    // name: a capability whose two profiles agree is not a capability, it is a
    // constant with a table row. Publishing keeps its own name and its own
    // reader — it rides `server/portal/`, mounted only when
    // `hasPortalIntegrationApi` is true, and that is a fact about the topology
    // rather than a gate: a standalone deployment has no platform on the other
    // end and nobody who could act as one.

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

    /** Whether the anonymous-submission surfaces (public booking, agent signup)
     *  MUST carry a bot challenge.
     *
     *  True in saas: those forms are reachable from the open internet on a
     *  platform we operate, and "nobody configured a key" is our misconfiguration
     *  to absorb, not a reason to leave them open. When no key is set the
     *  challenge runs on Cloudflare's public TEST keys — the widget still
     *  renders, the token is still required, the server still verifies — so the
     *  path stays exercised and switching to real keys is a config change rather
     *  than a code change. There is deliberately no bypass branch to forget to
     *  remove.
     *
     *  False in standalone: the operator runs their own deployment on their own
     *  domain and decides. A single-company install behind a private URL has a
     *  legitimate reason not to challenge anyone, and we are not in a position
     *  to overrule it. */
    botProtectionMandatory: boolean;

    /** Whether the tenant RECORD is owned by a platform that stores it
     *  elsewhere. True in saas: portal is the system of record for tenant
     *  status and tier, and this worker reads a projection of it, so the admin
     *  service takes `PortalProvider`. False in standalone: this deployment
     *  owns the row outright and `StandaloneProvider` writes it directly.
     *
     *  `di.ts` used to answer this by comparing `APP_MODE`, under an allowlist
     *  entry granted for what it may IMPORT rather than how it may test the
     *  mode. Naming the question is what makes the answer checkable. */
    tenantRecordOwnedByPortal: boolean;

    /** Whether the portal M2M surface (`/api/platform/*`) exists at all.
     *  False in standalone: there is no platform on the other end, so the entry
     *  404s the prefix rather than mounting a machine-to-machine API nobody can
     *  authenticate to. A surface that answers is a surface somebody probes.
     *
     *  Read at the worker entry, before any middleware — which is possible
     *  because `getDeploymentProfile` takes `ProfileEnv`, not `AppEnv`. That
     *  widening exists for exactly this class of caller; see the note on it. */
    hasPortalIntegrationApi: boolean;

    /** Whether there is anybody on the other end to hand an unreadable export to.
     *  False in standalone: a self-hosted deployment has no support team and the
     *  bucket is the operator's own, so the route is ABSENT rather than disabled.
     *  When false the intake path refuses an unmatched file BEFORE storing it —
     *  keeping a third party's personal data we could do nothing with has no
     *  reason behind it. */
    hasAssistedMigration: boolean;

    /** Largest spreadsheet an import will accept, in bytes. A DEFAULT, not a
     *  constant: the number that suits our hosting is the wrong number for a
     *  deployment whose per-request CPU budget is a fraction of it, which is why
     *  ProfileEnv can override every one of these three. */
    importMaxCsvBytes: number;

    /** Largest vendor export (JSON) an import will accept, in bytes. Larger than
     *  the spreadsheet cap because a template export carries structure a
     *  contact list does not — but still bounded by what one request can parse. */
    importMaxVendorExportBytes: number;

    /** Most entries one import may carry. Beyond it the run is refused with the
     *  real count, and the assisted route is what that operator wants instead. */
    importMaxRows: number;
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
    mcpApiRoute: '/mcp',
    videoBackendManaged: false,
    hasManagedCompliance: false,
    qboAppManaged: false,
    botProtectionMandatory: false,
    tenantRecordOwnedByPortal: false,
    hasPortalIntegrationApi: false,
    hasAssistedMigration: false,
    importMaxCsvBytes: 1_000_000,
    importMaxVendorExportBytes: 2_000_000,
    importMaxRows: 1_000,
};

export const SAAS_PROFILE: DeploymentProfile = {
    mode: 'saas',
    fixedTenantId: null,
    hasBilling: true, hasSeatQuota: true, hasUsageQuota: true, billingPortalUrl: null,
    loginRedirectBase: null,
    hasSetupWizard: false,
    aiDevMockFallback: false,
    hasManagedAi: true,
    mcpApiRoute: '/company/',
    videoBackendManaged: true,
    hasManagedCompliance: true,
    qboAppManaged: true,
    botProtectionMandatory: true,
    tenantRecordOwnedByPortal: true,
    hasPortalIntegrationApi: true,
    hasAssistedMigration: true,
    importMaxCsvBytes: 5_000_000,
    importMaxVendorExportBytes: 20_000_000,
    importMaxRows: 10_000,
};

/**
 * Resolve the active profile from request env. Pure function — same
 * env in, same profile out — so callers may memoise per-worker-
 * instance if desired.
 *
 * Precedence: APP_MODE=saas wins; standalone is the default. The
 * old SAAS_TOPOLOGY env var is no longer read.
 */
/**
 * A positive-integer override, or the default.
 *
 * Anything unparseable falls back rather than being treated as "no limit". A
 * typo in a deployment variable must not be the way a cap disappears — the
 * failure mode of a silently absent limit is a request that never finishes,
 * which is far harder to diagnose than a limit that stayed where it was.
 */
function positiveIntOr(raw: string | undefined, fallback: number): number {
    if (raw === undefined || raw.trim() === '') return fallback;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
    return parsed;
}

function withImportLimits(base: DeploymentProfile, env: ProfileEnv): DeploymentProfile {
    return {
        ...base,
        importMaxCsvBytes: positiveIntOr(env.IMPORT_MAX_CSV_BYTES, base.importMaxCsvBytes),
        importMaxVendorExportBytes: positiveIntOr(
            env.IMPORT_MAX_VENDOR_EXPORT_BYTES, base.importMaxVendorExportBytes,
        ),
        importMaxRows: positiveIntOr(env.IMPORT_MAX_ROWS, base.importMaxRows),
    };
}

export function getDeploymentProfile(env: ProfileEnv): DeploymentProfile {
    if (env.APP_MODE === 'saas') {
        const base = env.PORTAL_API_URL ? env.PORTAL_API_URL.replace(/\/$/, '') : null;
        return withImportLimits(
            { ...SAAS_PROFILE, billingPortalUrl: base, loginRedirectBase: base },
            env,
        );
    }
    return withImportLimits(
        { ...STANDALONE_PROFILE, fixedTenantId: env.SINGLE_TENANT_ID ?? FIXED_TENANT_FALLBACK },
        env,
    );
}
