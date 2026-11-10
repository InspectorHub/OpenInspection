import { describe, it, expect } from "vitest";
import { FULL_FEE_POLICY, depositPresetOf, depositPolicyFromChoice } from "./deposit-policy-form";
import { stripeStatusFrom } from "./settings/stripe-status";

describe("depositPresetOf", () => {
    it("reads no policy and an explicit none as off", () => {
        expect(depositPresetOf(null)).toBe("off");
        expect(depositPresetOf(undefined)).toBe("off");
        expect(depositPresetOf({ type: "none" })).toBe("off");
    });

    it("reads exactly 100 percent as the full-fee preset, whichever control stored it", () => {
        expect(depositPresetOf({ type: "percent", percent: 100 })).toBe("full");
        expect(depositPresetOf(FULL_FEE_POLICY)).toBe("full");
    });

    it("reads every other percent and every fixed amount as a custom deposit", () => {
        expect(depositPresetOf({ type: "percent", percent: 99 })).toBe("custom");
        expect(depositPresetOf({ type: "percent", percent: 20 })).toBe("custom");
        expect(depositPresetOf({ type: "fixed", amountCents: 10000 })).toBe("custom");
    });

    it("stores the full fee as a whole percent, never basis points", () => {
        expect(FULL_FEE_POLICY).toEqual({ type: "percent", percent: 100 });
    });

    it("round-trips: typing 100 into the deposit editor is the full-fee preset", () => {
        const r = depositPolicyFromChoice({ choice: "percent", percentText: "100", amountCents: null });
        expect(r).toEqual({ ok: true, policy: FULL_FEE_POLICY });
        expect(depositPresetOf(r.ok ? r.policy : null)).toBe("full");
    });
});

describe("stripeStatusFrom", () => {
    const body = (status: unknown) => ({ data: [{ id: "email", status: "connected" }, { id: "stripe", status }] });

    it("passes the three known statuses through", () => {
        expect(stripeStatusFrom(body("connected"))).toBe("connected");
        expect(stripeStatusFrom(body("attention"))).toBe("attention");
        expect(stripeStatusFrom(body("not_connected"))).toBe("not_connected");
    });

    it("never reads an unreadable answer as connected", () => {
        expect(stripeStatusFrom(null)).toBe("unknown");
        expect(stripeStatusFrom({ data: [] })).toBe("unknown");
        expect(stripeStatusFrom({ data: [{ id: "email", status: "connected" }] })).toBe("unknown");
        expect(stripeStatusFrom(body("weird"))).toBe("unknown");
    });
});
