/**
 * Deployment profile capability surface.
 *
 * Centralises every mode-specific decision the worker makes into 3 immutable
 * `DeploymentProfile` constants. Business code reads `c.var.profile.<capability>`
 * (injected by DI middleware) instead of branching on `env.APP_MODE` directly.
 * The 9 ad-hoc mode checks across the codebase collapse into this one factory.
 *
 * See `docs/superpowers/specs/2026-05-20-deployment-modes-design.md`.
 */

import type { AppEnv } from '../types/hono';

export type DeploymentMode = 'standalone' | 'saas';
export type SaasTopology  = 'shared' | 'silo';

export interface DeploymentProfile {
    mode: DeploymentMode;
    saasTopology?: SaasTopology;

    fixedTenantId: string | null;

    hasBilling: boolean;
    hasSeatQuota: boolean;
    billingPortalUrl: string | null;

    hasSetupWizard: boolean;

    aiDevMockFallback: boolean;

    brandingSource: 'env' | 'tenant-config';

    requireDnsProvisioning: boolean;
}

const FIXED_TENANT_FALLBACK = '00000000-0000-0000-0000-000000000000';

export const STANDALONE_PROFILE: DeploymentProfile = {
    mode: 'standalone',
    fixedTenantId: FIXED_TENANT_FALLBACK,
    hasBilling: false, hasSeatQuota: false, billingPortalUrl: null,
    hasSetupWizard: true,
    aiDevMockFallback: true,
    brandingSource: 'env',
    requireDnsProvisioning: false,
};

export const SAAS_SHARED_PROFILE: DeploymentProfile = {
    mode: 'saas', saasTopology: 'shared',
    fixedTenantId: null,
    hasBilling: true, hasSeatQuota: true, billingPortalUrl: null,
    hasSetupWizard: false,
    aiDevMockFallback: false,
    brandingSource: 'tenant-config',
    requireDnsProvisioning: false,
};

export const SAAS_SILO_PROFILE: DeploymentProfile = {
    ...SAAS_SHARED_PROFILE,
    saasTopology: 'silo',
    hasSeatQuota: false,
    requireDnsProvisioning: true,
};

/**
 * Resolve the active profile from request env. Pure function — same env in,
 * same profile out — so callers may memoise per-worker-instance if desired.
 *
 * Precedence: APP_MODE=saas wins (and SAAS_TOPOLOGY picks shared vs silo);
 * standalone is the default.
 */
export function getDeploymentProfile(env: AppEnv): DeploymentProfile {
    if (env.APP_MODE === 'saas') {
        const topology = (env.SAAS_TOPOLOGY ?? 'shared') as SaasTopology;
        const base = topology === 'silo' ? SAAS_SILO_PROFILE : SAAS_SHARED_PROFILE;
        return { ...base, billingPortalUrl: env.PORTAL_API_URL ?? null };
    }
    return { ...STANDALONE_PROFILE, fixedTenantId: env.SINGLE_TENANT_ID ?? FIXED_TENANT_FALLBACK };
}
