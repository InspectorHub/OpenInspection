/**
 * Deployment profile capability surface.
 *
 * Centralises every mode-specific decision the worker makes into 2
 * immutable `DeploymentProfile` constants. Business code reads
 * `c.var.profile.<capability>` (injected by DI middleware) instead
 * of branching on `env.APP_MODE` directly.
 *
 * Silo deconvergence (2026-05-29): silo + shared SaaS collapsed into
 * a single SAAS_PROFILE. The remaining "silo vs shared" distinction
 * is a per-tenant property (tenants.deploymentMode) that signals
 * which D1 backend to query — not a deployment-wide topology.
 *
 * See `docs/superpowers/specs/2026-05-20-deployment-modes-design.md`
 * (historical) and `docs/superpowers/plans/2026-05-29-silo-deconvergence.md`.
 */

import type { AppEnv } from '../types/hono';

export type DeploymentMode = 'standalone' | 'saas';

export interface DeploymentProfile {
    mode: DeploymentMode;

    fixedTenantId: string | null;

    hasBilling: boolean;
    hasSeatQuota: boolean;
    billingPortalUrl: string | null;

    hasSetupWizard: boolean;

    aiDevMockFallback: boolean;

    brandingSource: 'env' | 'tenant-config';
}

const FIXED_TENANT_FALLBACK = '00000000-0000-0000-0000-000000000000';

export const STANDALONE_PROFILE: DeploymentProfile = {
    mode: 'standalone',
    fixedTenantId: FIXED_TENANT_FALLBACK,
    hasBilling: false, hasSeatQuota: false, billingPortalUrl: null,
    hasSetupWizard: true,
    aiDevMockFallback: true,
    brandingSource: 'env',
};

export const SAAS_PROFILE: DeploymentProfile = {
    mode: 'saas',
    fixedTenantId: null,
    hasBilling: true, hasSeatQuota: true, billingPortalUrl: null,
    hasSetupWizard: false,
    aiDevMockFallback: false,
    brandingSource: 'tenant-config',
};

/**
 * Resolve the active profile from request env. Pure function — same
 * env in, same profile out — so callers may memoise per-worker-
 * instance if desired.
 *
 * Precedence: APP_MODE=saas wins; standalone is the default. The
 * old SAAS_TOPOLOGY env var is no longer read.
 */
export function getDeploymentProfile(env: AppEnv): DeploymentProfile {
    if (env.APP_MODE === 'saas') {
        return { ...SAAS_PROFILE, billingPortalUrl: env.PORTAL_API_URL ?? null };
    }
    return { ...STANDALONE_PROFILE, fixedTenantId: env.SINGLE_TENANT_ID ?? FIXED_TENANT_FALLBACK };
}
