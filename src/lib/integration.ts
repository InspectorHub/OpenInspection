/**
 * Interface for integration with external systems or local providers.
 * OpenInspection Core is decoupled from specific infrastructure logic.
 */
export interface IntegrationProvider {
    /**
     * Called when a tenant's status, tier, or metadata is updated.
     * In Standalone mode, this updates the local D1 database.
     */
    handleTenantUpdate(params: TenantUpdateParams): Promise<void>;


    /**
     * Returns whether certain features are available in this provider.
     */
    getCapabilities(): ProviderCapabilities;
}

export interface TenantUpdateParams {
    id?: string;
    status: string;
    tier?: 'free' | 'pro' | 'enterprise';
    name?: string;
    adminEmail?: string;
    adminPasswordHash?: string;
}

export interface ProviderCapabilities {
    allowsM2M: boolean;
}
