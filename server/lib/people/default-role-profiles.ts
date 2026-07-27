import type { RoleKind } from './capabilities';

export const PRIMARY_CLIENT_KEY = 'client';

/**
 * Where the primary-client seat's previous holder lands when it moves
 * (IA-36 ⑬). They stay on the inspection with their access intact — being
 * demoted is not leaving.
 */
export const SECONDARY_CLIENT_KEY = 'co_client';

// Seeded per tenant. Aligned with Spectora's default people set so migrated
// users keep their mental model. kind drives capabilities; label is editable.
export const DEFAULT_ROLE_PROFILES: Array<{
    key: string; label: string; kind: RoleKind; isSystem: boolean; sortOrder: number;
}> = [
    { key: 'client',                 label: 'Client',                 kind: 'client', isSystem: true,  sortOrder: 10 },
    { key: 'co_client',              label: 'Co-Client',              kind: 'client', isSystem: true,  sortOrder: 20 },
    { key: 'buyer_agent',            label: "Buyer's Agent",          kind: 'agent',  isSystem: true,  sortOrder: 30 },
    { key: 'listing_agent',          label: 'Listing Agent',          kind: 'agent',  isSystem: true,  sortOrder: 40 },
    { key: 'attorney',               label: 'Attorney',               kind: 'other',  isSystem: true,  sortOrder: 50 },
    { key: 'transaction_coordinator',label: 'Transaction Coordinator',kind: 'other',  isSystem: true,  sortOrder: 60 },
    { key: 'insurance_agent',        label: 'Insurance Agent',        kind: 'other',  isSystem: true,  sortOrder: 70 },
    { key: 'title_company',          label: 'Title Company',          kind: 'other',  isSystem: true,  sortOrder: 80 },
];
