/**
 * Task 6 (two-layer role model) — every seeded role writes all five capability
 * bits explicitly, so every row reads the same way and the override path is
 * exercised by 100% of rows from day one rather than only by edited ones.
 *
 * The one deliberate behaviour change: listing_agent gains showsInAgentPortal.
 * Safe only because canAccessRepairList stays 'off' — the listing agent sees
 * the inspection exists without reading the buyer's negotiation list.
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_ROLE_PROFILES } from '../../../server/lib/people/default-role-profiles';
import { capabilitiesForProfile } from '../../../server/lib/people/capabilities';

function caps(key: string) {
    const p = DEFAULT_ROLE_PROFILES.find(r => r.key === key);
    if (!p) throw new Error(`no seeded role ${key}`);
    return capabilitiesForProfile(p.kind, p.capabilityOverrides);
}

describe('seeded role capabilities', () => {
    it('writes all five bits on every seeded role', () => {
        for (const p of DEFAULT_ROLE_PROFILES) {
            expect(Object.keys(p.capabilityOverrides).sort()).toEqual([
                'canAccessRepairList', 'canHaveAccount', 'receivesReport',
                'selfRetrieveReport', 'showsInAgentPortal',
            ]);
        }
    });

    it("gives the buyer's agent the portal and the repair list", () => {
        expect(caps('buyer_agent').showsInAgentPortal).toBe(true);
        expect(caps('buyer_agent').canAccessRepairList).toBe('readwrite');
    });

    it('gives the listing agent the portal but NOT the repair list', () => {
        expect(caps('listing_agent').showsInAgentPortal).toBe(true);
        expect(caps('listing_agent').canAccessRepairList).toBe('off');
    });

    it('keeps clients out of the agent portal', () => {
        expect(caps('client').showsInAgentPortal).toBe(false);
        expect(caps('co_client').showsInAgentPortal).toBe(false);
    });

    it('leaves every other-kind role without self-retrieval or the repair list', () => {
        for (const key of ['attorney', 'transaction_coordinator', 'insurance_agent', 'title_company']) {
            expect(caps(key).selfRetrieveReport).toBe(false);
            expect(caps(key).canAccessRepairList).toBe('off');
        }
    });
});
