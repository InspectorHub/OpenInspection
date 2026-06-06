/**
 * Interface for integration with external systems or local providers.
 * OpenInspection Core is decoupled from specific infrastructure logic.
 */
export interface TenantUpdateParams {
    id?: string;
    slug: string;
    status: 'pending' | 'active' | 'suspended' | 'trial';
    tier?: 'free' | 'pro' | 'enterprise';
    name?: string;
    deploymentMode?: string;
    maxUsers?: number;
    adminEmail?: string;
    adminPasswordHash?: string;
    // Inspector display name. Captured at setup so /book/<slug> and
    // /inspector/<slug> never have to fall back to leaking email.
    adminName?: string;
}

export interface IntegrationProvider {
    /**
     * Called when a tenant's status, tier, or metadata is updated.
     * In Standalone mode, this updates the local D1 database.
     */
    handleTenantUpdate(params: TenantUpdateParams): Promise<void>;
    // handleStripeConnect was removed with the dead M2M stripe-connect endpoint
    // (A-21 batch 3 adjudication) — the live write path is the inspector-facing
    // AdminService.setStripeConnect.
}
