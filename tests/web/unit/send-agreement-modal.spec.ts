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
    it("defaults to an empty client row with a stable UUID key", () => {
        const s = emptySigner();
        expect(s.name).toBe("");
        expect(s.email).toBe("");
        expect(s.role).toBe("client");
        // key is a stable UUID — present but not empty.
        expect(typeof s.key).toBe("string");
        expect(s.key.length).toBeGreaterThan(0);
    });

    it("each call returns a distinct key (stable within a row, unique across rows)", () => {
        const a = emptySigner();
        const b = emptySigner();
        expect(a.key).not.toBe(b.key);
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

    it("strips the stable `key` field from SignerDraftRow inputs — key must not reach the server", () => {
        const row = emptySigner();
        row.name = "Jane";
        row.email = "jane@test.com";
        const payload = buildSendPayload([row], "all");
        expect(payload.signers[0]).toEqual({ name: "Jane", email: "jane@test.com", role: "client" });
        expect("key" in payload.signers[0]).toBe(false);
    });
});
