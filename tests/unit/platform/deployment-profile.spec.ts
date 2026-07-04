import { describe, it, expect } from 'vitest';
import {
    getDeploymentProfile,
    STANDALONE_PROFILE,
    SAAS_PROFILE,
} from '../../../server/lib/deployment-profile';
import type { AppEnv } from '../../../server/types/hono';

const FALLBACK_TENANT = '00000000-0000-0000-0000-000000000000';

/**
 * Section F rewrite. The old triple-profile + topology surface has been
 * flattened to two constants (standalone, saas) plus a `getDeploymentProfile`
 * factory that maps the runtime env to one of them. These tests pin the
 * capability matrix that the rest of the codebase reads through
 * `c.var.profile.<capability>`.
 */
describe('deployment profile constants', () => {
    it('STANDALONE_PROFILE has expected capabilities', () => {
        expect(STANDALONE_PROFILE.mode).toBe('standalone');
        expect(STANDALONE_PROFILE.fixedTenantId).not.toBeNull();
        expect(STANDALONE_PROFILE.fixedTenantId).toBe(FALLBACK_TENANT);
        expect(STANDALONE_PROFILE.hasBilling).toBe(false);
        expect(STANDALONE_PROFILE.hasSeatQuota).toBe(false);
        expect(STANDALONE_PROFILE.hasSetupWizard).toBe(true);
        expect(STANDALONE_PROFILE.brandingSource).toBe('env');
        expect(STANDALONE_PROFILE.billingPortalUrl).toBeNull();
    });

    it('SAAS_PROFILE marks billing + seat quota + tenant-config branding', () => {
        expect(SAAS_PROFILE.mode).toBe('saas');
        expect(SAAS_PROFILE.fixedTenantId).toBeNull();
        expect(SAAS_PROFILE.hasBilling).toBe(true);
        expect(SAAS_PROFILE.hasSeatQuota).toBe(true);
        expect(SAAS_PROFILE.hasSetupWizard).toBe(false);
        expect(SAAS_PROFILE.brandingSource).toBe('tenant-config');
    });
});

describe('getDeploymentProfile factory', () => {
    it('returns standalone-derived profile when APP_MODE is unset, with FALLBACK tenant id', () => {
        const env = { APP_MODE: undefined } as unknown as AppEnv;
        const profile = getDeploymentProfile(env);
        expect(profile.mode).toBe('standalone');
        expect(profile.fixedTenantId).toBe(FALLBACK_TENANT);
        expect(profile.hasSetupWizard).toBe(true);
        expect(profile.hasSeatQuota).toBe(false);
    });

    it('honors env.SINGLE_TENANT_ID override on standalone', () => {
        const env = { SINGLE_TENANT_ID: 'tenant-override-123' } as unknown as AppEnv;
        const profile = getDeploymentProfile(env);
        expect(profile.mode).toBe('standalone');
        expect(profile.fixedTenantId).toBe('tenant-override-123');
    });

    it('returns SAAS_PROFILE-derived profile when APP_MODE=saas', () => {
        const env = { APP_MODE: 'saas' } as unknown as AppEnv;
        const profile = getDeploymentProfile(env);
        expect(profile.mode).toBe('saas');
        expect(profile.fixedTenantId).toBeNull();
        expect(profile.hasBilling).toBe(true);
        expect(profile.hasSeatQuota).toBe(true);
        expect(profile.hasSetupWizard).toBe(false);
    });

    it('wires PORTAL_API_URL into billingPortalUrl on saas', () => {
        const env = {
            APP_MODE: 'saas',
            PORTAL_API_URL: 'https://portal.example.com',
        } as unknown as AppEnv;
        const profile = getDeploymentProfile(env);
        expect(profile.mode).toBe('saas');
        expect(profile.billingPortalUrl).toBe('https://portal.example.com');
    });

    it('leaves billingPortalUrl null on saas when PORTAL_API_URL is absent', () => {
        const env = { APP_MODE: 'saas' } as unknown as AppEnv;
        const profile = getDeploymentProfile(env);
        expect(profile.billingPortalUrl).toBeNull();
    });

    it('exposes hasUsageQuota: false standalone, true saas', () => {
        expect(getDeploymentProfile({ APP_MODE: undefined } as any).hasUsageQuota).toBe(false);
        expect(getDeploymentProfile({ APP_MODE: 'saas', PORTAL_API_URL: 'https://p' } as any).hasUsageQuota).toBe(true);
    });
});
