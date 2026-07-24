export type RoleKind = 'client' | 'agent' | 'other';

export interface RoleCapabilities {
    receivesReport: boolean;
    selfRetrieveReport: boolean;
    canHaveAccount: boolean;
}

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
        case 'client': return { receivesReport: true,  selfRetrieveReport: true,  canHaveAccount: false };
        case 'agent':  return { receivesReport: true,  selfRetrieveReport: true,  canHaveAccount: true  };
        case 'other':  return { receivesReport: true,  selfRetrieveReport: false, canHaveAccount: false };
        // Fail closed: callers cast DB `kind` strings through `as RoleKind`, so a
        // corrupt/out-of-enum value would otherwise return undefined and throw on
        // `[cap]` access. An unknown role gets NO capabilities (no report, no
        // account), never an accidental grant.
        default:       return { receivesReport: false, selfRetrieveReport: false, canHaveAccount: false };
    }
}
