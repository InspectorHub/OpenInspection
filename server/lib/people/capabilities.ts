export type RoleKind = 'client' | 'agent' | 'other';

export interface RoleCapabilities {
    receivesReport: boolean;
    selfRetrieveReport: boolean;
    canSign: boolean;
    canPay: boolean;
    canHaveAccount: boolean;
}

// Single source of truth for every role capability decision. Spec 3 flips agent
// flags here (e.g. selfRetrieveReport) to open the agent portal — one edit, no
// scattered SQL. A future capabilitiesForProfile() can layer per-row overrides
// on top of this kind default without touching call sites.
export function capabilitiesForKind(kind: RoleKind): RoleCapabilities {
    switch (kind) {
        case 'client': return { receivesReport: true, selfRetrieveReport: true,  canSign: true,  canPay: true,  canHaveAccount: false };
        case 'agent':  return { receivesReport: true, selfRetrieveReport: true,  canSign: true,  canPay: true,  canHaveAccount: true  };
        case 'other':  return { receivesReport: true, selfRetrieveReport: false, canSign: false, canPay: false, canHaveAccount: false };
    }
}
