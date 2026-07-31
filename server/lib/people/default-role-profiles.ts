import type { RoleKind, RoleCapabilities } from './capabilities';

export const PRIMARY_CLIENT_KEY = 'client';

/**
 * Where the primary-client seat's previous holder lands when it moves
 * (IA-36 ⑬). They stay on the inspection with their access intact — being
 * demoted is not leaving.
 */
export const SECONDARY_CLIENT_KEY = 'co_client';

/**
 * Seeded per tenant. Aligned with Spectora's default people set so migrated
 * users keep their mental model. `kind` sets the baseline; capabilityOverrides
 * states every bit explicitly.
 *
 * Explicit rather than inherited, deliberately: every row then reads the same
 * way, and the override path is exercised by all data rather than only by
 * edited rows — a path used by a minority of data is a path that rots quietly.
 *
 * CONSEQUENCE: changing a kind default in capabilities.ts no longer reaches
 * existing tenants, and adding a sixth bit is a BACKFILL, not a default. Do
 * both deliberately.
 */
export const DEFAULT_ROLE_PROFILES: Array<{
    key: string; label: string; kind: RoleKind; isSystem: boolean; sortOrder: number;
    capabilityOverrides: RoleCapabilities;
}> = [
    { key: 'client',    label: 'Client',    kind: 'client', isSystem: true, sortOrder: 10,
      capabilityOverrides: { receivesReport: true, selfRetrieveReport: true, canHaveAccount: false, showsInAgentPortal: false, canAccessRepairList: 'off' } },
    { key: 'co_client', label: 'Co-Client', kind: 'client', isSystem: true, sortOrder: 20,
      capabilityOverrides: { receivesReport: true, selfRetrieveReport: true, canHaveAccount: false, showsInAgentPortal: false, canAccessRepairList: 'off' } },
    // The buyer's agent is the only role that reaches the buyer's repair list.
    { key: 'buyer_agent', label: "Buyer's Agent", kind: 'agent', isSystem: true, sortOrder: 30,
      capabilityOverrides: { receivesReport: true, selfRetrieveReport: true, canHaveAccount: true, showsInAgentPortal: true, canAccessRepairList: 'readwrite' } },
    // Portal visibility WITHOUT the repair list: a listing agent represents the
    // other side of the negotiation, and the repair list is what the buyer uses
    // to negotiate price.
    { key: 'listing_agent', label: 'Listing Agent', kind: 'agent', isSystem: true, sortOrder: 40,
      capabilityOverrides: { receivesReport: true, selfRetrieveReport: true, canHaveAccount: true, showsInAgentPortal: true, canAccessRepairList: 'off' } },
    { key: 'attorney', label: 'Attorney', kind: 'other', isSystem: true, sortOrder: 50,
      capabilityOverrides: { receivesReport: true, selfRetrieveReport: false, canHaveAccount: false, showsInAgentPortal: false, canAccessRepairList: 'off' } },
    { key: 'transaction_coordinator', label: 'Transaction Coordinator', kind: 'other', isSystem: true, sortOrder: 60,
      capabilityOverrides: { receivesReport: true, selfRetrieveReport: false, canHaveAccount: false, showsInAgentPortal: false, canAccessRepairList: 'off' } },
    { key: 'insurance_agent', label: 'Insurance Agent', kind: 'other', isSystem: true, sortOrder: 70,
      capabilityOverrides: { receivesReport: true, selfRetrieveReport: false, canHaveAccount: false, showsInAgentPortal: false, canAccessRepairList: 'off' } },
    { key: 'title_company', label: 'Title Company', kind: 'other', isSystem: true, sortOrder: 80,
      capabilityOverrides: { receivesReport: true, selfRetrieveReport: false, canHaveAccount: false, showsInAgentPortal: false, canAccessRepairList: 'off' } },
];
