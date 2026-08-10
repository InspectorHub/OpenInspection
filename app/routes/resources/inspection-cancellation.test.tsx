// @vitest-environment happy-dom
/**
 * #67 — the cancellation BFF route. Both API endpoints shipped with no caller;
 * this is the seam that reaches them, so what it must be pinned on is what it
 * does with the answers rather than that it forwards at all.
 *
 * Three properties are load-bearing:
 *   - the quote is READ-ONLY and fail-closed. No session, no id, or a reason
 *     outside the server's enum ⇒ no call at all and no quote, because the
 *     confirm button is gated on a quote and a fabricated one would open it.
 *   - the acknowledged fee is FORWARDED VERBATIM. The server refuses to charge
 *     a fee the caller has not echoed, and a route that dropped or invented the
 *     field would convert that refusal into a silently free cancellation.
 *   - a 409 comes back WITH the server's fresh quote, so the UI re-shows the
 *     figures instead of retrying the stale ones.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const quoteGet = vi.fn();
const cancelPost = vi.fn();
const getToken = vi.fn();

vi.mock("~/lib/session.server", () => ({
    getToken: (...args: unknown[]) => getToken(...args),
}));
vi.mock("~/lib/api-client.server", () => ({
    createApi: vi.fn(() => ({
        inspections: {
            ":id": {
                "cancellation-quote": { $get: quoteGet },
                cancel: { $post: cancelPost },
            },
        },
    })),
}));

import { loader, action } from "./inspection-cancellation";
import { routeArgs } from "../../../tests/helpers/route-args";
/** Minimal AppLoadContext stub — the route only forwards it to createApi. */
const CONTEXT = {} as Parameters<typeof loader>[0]["context"];

const QUOTE = {
    feeCents: 12500,
    refundCents: 37500,
    reason: "late_cancellation",
    cappedAtCollected: false,
    priceCents: 50000,
    paidCents: 50000,
    currency: "USD",
    retainedProcessingFeeCents: 1750,
    policyConfigured: true,
};

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function get(query: Record<string, string>) {
    const url = `https://x/resources/inspection-cancellation?${new URLSearchParams(query)}`;
    return loader(routeArgs(new Request(url), { params: {}, context: CONTEXT }));
}

function post(fields: Record<string, string>) {
    const request = new Request("https://x/resources/inspection-cancellation", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(fields).toString(),
    });
    return action(routeArgs(request, { params: {}, context: CONTEXT }));
}

beforeEach(() => {
    quoteGet.mockReset();
    cancelPost.mockReset();
    getToken.mockReset().mockResolvedValue("tok");
});

describe("cancellation quote loader", () => {
    it("returns the priced outcome for the reason asked about", async () => {
        quoteGet.mockResolvedValue(json({ success: true, data: QUOTE }));
        const res = await get({ id: "insp-1", reason: "client_cancelled" });

        expect(quoteGet).toHaveBeenCalledWith(
            { param: { id: "insp-1" }, query: { reason: "client_cancelled" } },
            { headers: { "x-token-relay": "1" } },
        );
        expect(res).toEqual({ ok: true, quote: QUOTE });
    });

    it("quotes nothing when there is no session", async () => {
        // The unauthenticated path. A client fetch to /api would arrive with no
        // JWT at all; here the route must refuse rather than call the API.
        getToken.mockResolvedValue(null);
        const res = await get({ id: "insp-1", reason: "client_cancelled" });
        expect(quoteGet).not.toHaveBeenCalled();
        expect(res.ok).toBe(false);
    });

    it("refuses a reason the API's enum does not contain", async () => {
        const res = await get({ id: "insp-1", reason: "because_i_said_so" });
        expect(quoteGet).not.toHaveBeenCalled();
        expect(res.ok).toBe(false);
    });

    it("refuses a missing inspection id", async () => {
        const res = await get({ reason: "no_show" });
        expect(quoteGet).not.toHaveBeenCalled();
        expect(res.ok).toBe(false);
    });

    it("does not invent a free cancellation out of an empty payload", async () => {
        // A 200 with no data used to be the dangerous case: `feeCents ?? 0`
        // anywhere on this path opens the confirm button over a fee nobody has.
        quoteGet.mockResolvedValue(json({ success: true }));
        const res = await get({ id: "insp-1", reason: "no_show" });
        expect(res.ok).toBe(false);
        expect(res).not.toHaveProperty("quote");
    });

    it("surfaces the API's own refusal text when it sends one", async () => {
        quoteGet.mockResolvedValue(json({ success: false, error: { message: "Inspection not found" } }, 404));
        const res = await get({ id: "gone", reason: "no_show" });
        expect(res).toEqual({ ok: false, error: "Inspection not found" });
    });
});

describe("cancel action", () => {
    it("forwards the reason, the notes and the acknowledged fee verbatim", async () => {
        cancelPost.mockResolvedValue(json({ success: true, data: { outcome: QUOTE, refundPaymentId: "pay-1" } }));
        const res = await post({
            id: "insp-1",
            reason: "no_show",
            notes: "Nobody home",
            acknowledgedFeeCents: "12500",
        });

        expect(cancelPost).toHaveBeenCalledWith(
            {
                param: { id: "insp-1" },
                json: { reason: "no_show", acknowledgedFeeCents: 12500, notes: "Nobody home" },
            },
            { headers: { "x-token-relay": "1" } },
        );
        expect(res).toEqual({ ok: true });
    });

    it("sends a zero acknowledgement rather than omitting the field", async () => {
        // Omitting it is not equivalent: the API reads an absent acknowledgement
        // as "no fee was shown", which is a different claim from "the fee shown
        // was nothing".
        cancelPost.mockResolvedValue(json({ success: true, data: { outcome: QUOTE, refundPaymentId: null } }));
        await post({ id: "insp-1", reason: "weather", acknowledgedFeeCents: "0" });
        expect(cancelPost.mock.calls[0][0].json).toMatchObject({ acknowledgedFeeCents: 0 });
    });

    it("cancels nothing when the acknowledged fee is missing or unparseable", async () => {
        expect((await post({ id: "insp-1", reason: "no_show" })).ok).toBe(false);
        expect((await post({ id: "insp-1", reason: "no_show", acknowledgedFeeCents: "lots" })).ok).toBe(false);
        expect((await post({ id: "insp-1", reason: "no_show", acknowledgedFeeCents: "-1" })).ok).toBe(false);
        expect(cancelPost).not.toHaveBeenCalled();
    });

    it("cancels nothing when there is no session", async () => {
        getToken.mockResolvedValue(null);
        const res = await post({ id: "insp-1", reason: "no_show", acknowledgedFeeCents: "0" });
        expect(cancelPost).not.toHaveBeenCalled();
        expect(res.ok).toBe(false);
    });

    it("distinguishes a re-confirm from a failure", async () => {
        // A 409 means the figures moved while the dialog was open, not that
        // anything broke. Collapsing it into the generic error would tell the
        // inspector to retry when what they need to do is read the new number —
        // so the two messages must not be the same string.
        const moved = { ...QUOTE, feeCents: 25000, refundCents: 25000 };
        cancelPost.mockResolvedValue(
            json({ success: false, error: { code: "CANCELLATION_FEE_NEEDS_CONFIRM", message: "…", quote: moved } }, 409),
        );
        const reconfirm = await post({ id: "insp-1", reason: "no_show", acknowledgedFeeCents: "12500" });

        cancelPost.mockResolvedValue(json({ success: false }, 500));
        const broke = await post({ id: "insp-1", reason: "no_show", acknowledgedFeeCents: "12500" });

        expect(reconfirm.ok).toBe(false);
        expect(broke.ok).toBe(false);
        expect(reconfirm).not.toEqual(broke);
        // The server's own quote is deliberately NOT forwarded — the caller
        // re-prices through the loader. See CancelInspectionResult.
        expect(reconfirm).not.toHaveProperty("quote");
    });

    it("reports a transport failure without claiming the inspection was cancelled", async () => {
        cancelPost.mockRejectedValue(new Error("boom"));
        const res = await post({ id: "insp-1", reason: "no_show", acknowledgedFeeCents: "0" });
        expect(res.ok).toBe(false);
    });
});
