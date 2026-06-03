/**
 * Interface for integration with external systems or local providers.
 * OpenInspection Core is decoupled from specific infrastructure logic.
 */
export interface TenantUpdateParams {
    id?: string;
    slug: string;
    status: string;
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

    /**
     * Called when a tenant connects their Stripe account.
     */
    handleStripeConnect?(slug: string, accountId: string): Promise<void>;
}
