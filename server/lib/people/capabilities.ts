import { coerceOverrides, type BitDecl } from '../auth/capability-overrides';
import type { RoleKind } from './role-kinds';

// RoleKind's source of truth moved to role-kinds.ts (Task 16, two-layer role
// model) so value-position consumers can use ROLE_KIND.* constants; re-exported
// here so existing imports keep working.
export type { RoleKind } from './role-kinds';
type RepairAccess = 'off' | 'read' | 'readwrite';

export interface RoleCapabilities {
    receivesReport: boolean;
    selfRetrieveReport: boolean;
    canHaveAccount: boolean;
    /** Appears in that agent's own portal list. Agent-kind default; see IA-112. */
    showsInAgentPortal: boolean;
    /** Access to the buyer's repair-request list. Resolved against the tenant's
     *  agentRepairAccess policy by taking the STRICTER of the two. */
    canAccessRepairList: RepairAccess;
}

/** Declared shape of every contact-role bit, for the shared override whitelist. */
export const CONTACT_BITS: BitDecl = {
    receivesReport:      'boolean',
    selfRetrieveReport:  'boolean',
    canHaveAccount:      'boolean',
    showsInAgentPortal:  'boolean',
    canAccessRepairList: ['off', 'read', 'readwrite'] as const,
};

// Single source of truth for every role capability decision. Spec 3 flips agent
// flags here (e.g. selfRetrieveReport) to open the agent portal — one edit, no
// scattered SQL. A future capabilitiesForProfile() can layer per-row overrides
// on top of this kind default without touching call sites.
//
// canSign / canPay were removed (#IA-53): they were declared true for client and
// agent but had ZERO consumers anywhere in the codebase — no route or component
// ever read them. A never-true-because-never-read capability reads to the next
// person as "supported, just not wired up" and invites accidental wiring. Agent
// self-signing / self-paying is a product decision we are NOT making here; if it
// is ever revisited it needs its own model (co-signer attestation, payment/report
// access coupling), not a dormant boolean. Report access is unaffected — it flows
// through the token/account tracks and selfRetrieveReport, not these bits.
export function capabilitiesForKind(kind: RoleKind): RoleCapabilities {
    switch (kind) {
        case 'client': return { receivesReport: true,  selfRetrieveReport: true,  canHaveAccount: false, showsInAgentPortal: false, canAccessRepairList: 'off' };
        case 'agent':  return { receivesReport: true,  selfRetrieveReport: true,  canHaveAccount: true,  showsInAgentPortal: true,  canAccessRepairList: 'off' };
        case 'other':  return { receivesReport: true,  selfRetrieveReport: false, canHaveAccount: false, showsInAgentPortal: false, canAccessRepairList: 'off' };
        // Fail closed: callers cast DB `kind` strings through `as RoleKind`, so a
        // corrupt/out-of-enum value would otherwise return undefined and throw on
        // `[cap]` access. An unknown role gets NO capabilities (no report, no
        // account), never an accidental grant.
        default:       return { receivesReport: false, selfRetrieveReport: false, canHaveAccount: false, showsInAgentPortal: false, canAccessRepairList: 'off' };
    }
}

/**
 * The kind baseline with a role profile's own overrides layered on top.
 *
 * PURE — overrides arrive as an argument and this function never reads the
 * database. app/components/inspection/AddPersonModal.tsx imports this module
 * into the BROWSER bundle; adding a query here breaks the client build, and the
 * failure looks like a bundler problem rather than a design violation (the
 * eslint no-restricted-imports gate on this file states the same rule).
 */
export function capabilitiesForProfile(kind: RoleKind, overrides: unknown): RoleCapabilities {
    // eslint-disable-next-line no-restricted-syntax -- the ONE legitimate call site: this IS the override layer the rule sends everyone to.
    const base = capabilitiesForKind(kind);
    const applied = coerceOverrides(CONTACT_BITS, overrides);
    return applied ? { ...base, ...applied } as RoleCapabilities : base;
}
