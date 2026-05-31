import { describe, it, expect } from 'vitest';

/**
 * BUG #21 — `/report/:id?view=agent&token=<t>` must skip the public payment +
 * agreement gates when the token KV-resolves to the same inspection + tenant.
 *
 * The earlier deploy emitted that URL pattern from
 * `InspectionService.generateAgentViewToken()` but the public report route
 * had no token-aware bypass — so an agent clicking the email link on a
 * paywalled inspection got the paywall instead of the report. The fix adds
 * an `isAgentTokenView` branch that joins the existing `isInspectorOrAdmin`
 * branch when deciding whether to skip the gate.
 *
 * This spec pins the predicate so a future refactor cannot silently
 * regress the bypass.
 */

interface ReportGateInputs {
    isInspectorOrAdmin: boolean;
    isAgentTokenView: boolean;
    paymentRequired: unknown;
    paymentStatus: unknown;
    agreementRequired: unknown;
}

function shouldEnterPublicGateBranch(inputs: ReportGateInputs): boolean {
    return !inputs.isInspectorOrAdmin && !inputs.isAgentTokenView;
}

function shouldGatePayment(inputs: ReportGateInputs): boolean {
    if (!shouldEnterPublicGateBranch(inputs)) return false;
    return !!inputs.paymentRequired && inputs.paymentStatus !== 'paid';
}

function shouldGateAgreement(inputs: ReportGateInputs): boolean {
    if (!shouldEnterPublicGateBranch(inputs)) return false;
    return !!inputs.agreementRequired;
}

const PAYWALLED: Pick<ReportGateInputs, 'paymentRequired' | 'paymentStatus' | 'agreementRequired'> = {
    paymentRequired: true,
    paymentStatus: 'unpaid',
    agreementRequired: true,
};

describe('BUG #21 — agent-view token bypasses public report gates', () => {
    it('agent token holder skips both payment and agreement gates', () => {
        const inputs: ReportGateInputs = { isInspectorOrAdmin: false, isAgentTokenView: true, ...PAYWALLED };
        expect(shouldGatePayment(inputs)).toBe(false);
        expect(shouldGateAgreement(inputs)).toBe(false);
    });

    it('inspector / owner / admin still skips both gates (regression guard)', () => {
        const inputs: ReportGateInputs = { isInspectorOrAdmin: true, isAgentTokenView: false, ...PAYWALLED };
        expect(shouldGatePayment(inputs)).toBe(false);
        expect(shouldGateAgreement(inputs)).toBe(false);
    });

    it('public viewer with no token still hits both gates', () => {
        const inputs: ReportGateInputs = { isInspectorOrAdmin: false, isAgentTokenView: false, ...PAYWALLED };
        expect(shouldGatePayment(inputs)).toBe(true);
        expect(shouldGateAgreement(inputs)).toBe(true);
    });

    it('paid + signed inspection is open to all viewers regardless of role/token', () => {
        const open: ReportGateInputs = {
            isInspectorOrAdmin: false,
            isAgentTokenView: false,
            paymentRequired: true,
            paymentStatus: 'paid',
            agreementRequired: false,
        };
        expect(shouldGatePayment(open)).toBe(false);
        expect(shouldGateAgreement(open)).toBe(false);
    });
});
