import { describe, it, expect } from "vitest";
import { readPaymentSettings } from "./booking-payment-data";
import { stripeStatusFromResponse } from "./stripe-status";

describe("readPaymentSettings", () => {
    it("keeps ABSENT distinct from null: a manager without company-finance access", () => {
        expect(readPaymentSettings({ currency: "EUR" }).depositPolicy).toBeUndefined();
        expect(readPaymentSettings(undefined).depositPolicy).toBeUndefined();
    });

    it("a stored null is null, a stored policy is the policy", () => {
        expect(readPaymentSettings({ depositPolicy: null }).depositPolicy).toBeNull();
        expect(readPaymentSettings({ depositPolicy: { type: "percent", percent: 20 } }).depositPolicy)
            .toEqual({ type: "percent", percent: 20 });
    });

    it("carries the company currency and falls back to USD only when it is missing", () => {
        expect(readPaymentSettings({ currency: "CAD", depositPolicy: null }).currency).toBe("CAD");
        expect(readPaymentSettings({ depositPolicy: null }).currency).toBe("USD");
        expect(readPaymentSettings(undefined).currency).toBe("USD");
    });
});

describe("stripeStatusFromResponse", () => {
    const body = { data: [{ id: "stripe", status: "connected" }] };

    it("reads a good overview", async () => {
        expect(await stripeStatusFromResponse({ ok: true, json: async () => body })).toBe("connected");
    });

    it("reads a 200 with an unparseable body as unknown instead of throwing", async () => {
        const res = { ok: true, json: async () => { throw new SyntaxError("Unexpected token <"); } };
        expect(await stripeStatusFromResponse(res)).toBe("unknown");
    });

    it("reads a failed or missing request as unknown", async () => {
        expect(await stripeStatusFromResponse({ ok: false, json: async () => body })).toBe("unknown");
        expect(await stripeStatusFromResponse(null)).toBe("unknown");
    });
});
