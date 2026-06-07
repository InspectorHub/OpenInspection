/**
 * Track I-a Task 9 — SendAgreementModal validation logic. (Rendered rows /
 * add-remove / radios are Chrome-verified; happy-dom has no render harness.)
 */
import { describe, it, expect } from "vitest";
import { validateSigners, emptySigner, buildSendPayload } from "~/components/agreements/SendAgreementModal";

describe("validateSigners", () => {
    it("rejects an empty signer set", () => {
        expect(validateSigners([])).toMatch(/at least one/i);
    });
    it("requires a name on every row", () => {
        expect(validateSigners([{ name: "", email: "a@b.com", role: "client" }])).toMatch(/name/i);
    });
    it("rejects an invalid email", () => {
        expect(validateSigners([{ name: "Jane", email: "nope", role: "client" }])).toMatch(/not a valid email/i);
    });
    it("rejects duplicate emails case-insensitively", () => {
        const r = validateSigners([
            { name: "Jane", email: "x@y.com", role: "client" },
            { name: "John", email: "X@Y.COM", role: "co_client" },
        ]);
        expect(r).toMatch(/duplicate/i);
    });
    it("passes a clean multi-signer draft", () => {
        expect(validateSigners([
            { name: "Jane", email: "jane@test.com", role: "client" },
            { name: "John", email: "john@test.com", role: "co_client" },
        ])).toBeNull();
    });
});

describe("emptySigner", () => {
    it("defaults to an empty client row", () => {
        expect(emptySigner()).toEqual({ name: "", email: "", role: "client" });
    });
});

// The Signing-tab wiring submits `buildSendPayload(...)` under intent 'send'.
// happy-dom has no render harness (see signer-list.spec header), so the
// submit-payload builder is unit-tested directly; the modal open / select
// gating is Chrome-verified.
describe("buildSendPayload — Signing tab 'send' intent body", () => {
    it("trims name/email, preserves role, and carries the completion policy", () => {
        const payload = buildSendPayload(
            [
                { name: "  Jane  ", email: " jane@test.com ", role: "client" },
                { name: "John", email: "john@test.com", role: "co_client" },
            ],
            "one",
        );
        expect(payload).toEqual({
            completionPolicy: "one",
            signers: [
                { name: "Jane", email: "jane@test.com", role: "client" },
                { name: "John", email: "john@test.com", role: "co_client" },
            ],
        });
    });

    it("round-trips through JSON.stringify as the route serializes it", () => {
        const payload = buildSendPayload([{ name: "Jane", email: "jane@test.com", role: "agent" }], "all");
        // The route posts `signers: JSON.stringify(payload.signers)`; assert the
        // server receives exactly the trimmed signer objects with role intact.
        expect(JSON.parse(JSON.stringify(payload.signers))).toEqual([
            { name: "Jane", email: "jane@test.com", role: "agent" },
        ]);
        expect(payload.completionPolicy).toBe("all");
    });
});
