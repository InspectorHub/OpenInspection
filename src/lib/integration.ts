/**
 * Interface for integration with external systems or local providers.
 * OpenInspection Core is decoupled from specific infrastructure logic.
 */
export interface TenantUpdateParams {
    id?: string;
    subdomain: string;
    status: string;
    tier?: 'free' | 'pro' | 'enterprise';
    name?: string;
    deploymentMode?: string;
    adminEmail?: string;
    adminPasswordHash?: string;
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
    handleStripeConnect?(subdomain: string, accountId: string): Promise<void>;
}
