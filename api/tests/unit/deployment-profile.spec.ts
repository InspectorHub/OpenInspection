import { describe, it, expect } from 'vitest';
import {
    getDeploymentProfile,
    STANDALONE_PROFILE,
    SAAS_SHARED_PROFILE,
    SAAS_SILO_PROFILE,
} from '../../src/lib/deployment-profile';

const FALLBACK_TENANT = '00000000-0000-0000-0000-000000000000';

describe('deployment profile constants', () => {
    it('STANDALONE_PROFILE has expected capabilities', () => {
        expect(STANDALONE_PROFILE.mode).toBe('standalone');
        expect(STANDALONE_PROFILE.fixedTenantId).toBe(FALLBACK_TENANT);
        expect(STANDALONE_PROFILE.hasBilling).toBe(false);
        expect(STANDALONE_PROFILE.hasSeatQuota).toBe(false);
        expect(STANDALONE_PROFILE.hasSetupWizard).toBe(true);
        expect(STANDALONE_PROFILE.aiDevMockFallback).toBe(true);
        expect(STANDALONE_PROFILE.brandingSource).toBe('env');
    });

    it('SAAS_SHARED_PROFILE marks billing + seat quota', () => {
        expect(SAAS_SHARED_PROFILE.mode).toBe('saas');
        expect(SAAS_SHARED_PROFILE.saasTopology).toBe('shared');
        expect(SAAS_SHARED_PROFILE.fixedTenantId).toBeNull();
        expect(SAAS_SHARED_PROFILE.hasBilling).toBe(true);
        expect(SAAS_SHARED_PROFILE.hasSeatQuota).toBe(true);
        expect(SAAS_SHARED_PROFILE.hasSetupWizard).toBe(false);
        expect(SAAS_SHARED_PROFILE.brandingSource).toBe('tenant-config');
    });

    it('SAAS_SILO_PROFILE drops seat quota, requires DNS provisioning', () => {
        expect(SAAS_SILO_PROFILE.mode).toBe('saas');
        expect(SAAS_SILO_PROFILE.saasTopology).toBe('silo');
        expect(SAAS_SILO_PROFILE.hasSeatQuota).toBe(false);
        expect(SAAS_SILO_PROFILE.requireDnsProvisioning).toBe(true);
        expect(SAAS_SILO_PROFILE.hasBilling).toBe(true);
    });
});

describe('getDeploymentProfile factory', () => {
    it('returns SAAS_SHARED_PROFILE when APP_MODE=saas (default topology)', () => {
        const p = getDeploymentProfile({ APP_MODE: 'saas', PORTAL_API_URL: 'https://portal.example' } as never);
        expect(p.mode).toBe('saas');
        expect(p.saasTopology).toBe('shared');
        expect(p.billingPortalUrl).toBe('https://portal.example');
    });

    it('returns SAAS_SILO_PROFILE when APP_MODE=saas + SAAS_TOPOLOGY=silo', () => {
        const p = getDeploymentProfile({ APP_MODE: 'saas', SAAS_TOPOLOGY: 'silo' } as never);
        expect(p.saasTopology).toBe('silo');
    });

    it('returns STANDALONE_PROFILE by default with FALLBACK tenant id', () => {
        const p = getDeploymentProfile({} as never);
        expect(p.mode).toBe('standalone');
        expect(p.fixedTenantId).toBe(FALLBACK_TENANT);
    });

    it('honors env.SINGLE_TENANT_ID override on standalone', () => {
        const tenantUuid = '11111111-2222-3333-4444-555555555555';
        const p = getDeploymentProfile({ SINGLE_TENANT_ID: tenantUuid } as never);
        expect(p.fixedTenantId).toBe(tenantUuid);
    });
});
