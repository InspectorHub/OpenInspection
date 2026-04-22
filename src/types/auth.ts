export interface User {
    sub: string;
    role: 'owner' | 'admin' | 'inspector' | 'agent';
    tenantId?: string;
}

export type UserRole = User['role'];

export interface BrandingConfig {
    siteName: string;
    primaryColor: string;
    logoUrl: string | null;
    supportEmail: string;
    billingUrl: string;
    gaMeasurementId?: string | null | undefined;
}

import { ScopedDB } from '../lib/db/scoped';

export interface AuthVariables {
    tenantId: string;
    resolvedTenantId?: string; // Explicitly tracked for isolation guard
    user: User;
    userRole: UserRole;
    requestedSubdomain?: string;
    tenantTier?: string;
    tenantStatus?: string;
    branding?: BrandingConfig;
    sdb?: ScopedDB;
}

export interface InspectionData {
    sections: Array<{
        id: string;
        title: string;
        items: Array<{
            id: string;
            label: string;
            description?: string;
            status?: 'Satisfactory' | 'Monitor' | 'Defect' | 'Not Inspected';
            notes?: string;
            photos?: Array<{
                key: string;
                pending?: boolean;
                dataUrl?: string;
            }>;
        }>;
    }>;
}
