// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { FieldCommand } from "@core/field-ui/commands";
import { decodeResult } from "./web-commands";
import { SAMPLES } from "./web-commands.fixtures";

const JSON_CT = { contentType: "application/json" };

describe("decodeResult", () => {
    it("reads a plain success and failure", () => {
        expect(decodeResult(SAMPLES.complete, 200, { ok: true, intent: "complete" }, JSON_CT)).toEqual({ ok: true });
        expect(decodeResult(SAMPLES.complete, 200, { ok: false, intent: "complete" }, JSON_CT)).toEqual({ ok: false });
    });

    it("carries the action error sentence", () => {
        const r = decodeResult(SAMPLES.publish, 200, { ok: false, intent: "publish", error: "Must be completed" }, JSON_CT);
        expect(r).toEqual({ ok: false, error: "Must be completed" });
    });

    it("add-statutory-instance: a failure with no ok is ok:false", () => {
        const r = decodeResult(SAMPLES["add-statutory-instance"], 200, { error: "No such slot" }, JSON_CT);
        expect(r).toEqual({ ok: false, error: "No such slot" });
        expect(decodeResult(SAMPLES["add-statutory-instance"], 200, { ok: true }, JSON_CT)).toEqual({ ok: true });
    });

    it("sign-inspector: decodes without an echoed intent", () => {
        expect(decodeResult(SAMPLES["sign-inspector"], 200, { ok: true }, JSON_CT)).toEqual({ ok: true });
        expect(decodeResult(SAMPLES["sign-inspector"], 200, { ok: false }, JSON_CT)).toEqual({ ok: false });
    });

    it("upload-cover: data only when ok, even if a failed answer carries coverKey", () => {
        const body = { ok: true, intent: "upload-cover", coverKey: "k9", coverUrl: "/u" };
        expect(decodeResult(SAMPLES["upload-cover"], 200, body, JSON_CT)).toEqual({ ok: true, data: { coverKey: "k9", coverUrl: "/u" } });
        expect(decodeResult(SAMPLES["upload-cover"], 200, { ...body, ok: false }, JSON_CT)).toEqual({ ok: false });
        expect(decodeResult(SAMPLES["upload-cover"], 200, { ok: true, coverKey: "k9", coverUrl: null }, JSON_CT).data).toEqual({ coverKey: "k9", coverUrl: null });
    });

    it("crop-cover: coverKey is null when absent", () => {
        expect(decodeResult(SAMPLES["crop-cover"], 200, { ok: true, coverKey: null }, JSON_CT)).toEqual({ ok: true, data: { coverKey: null } });
        expect(decodeResult(SAMPLES["crop-cover"], 200, { ok: true, coverKey: "c1" }, JSON_CT).data).toEqual({ coverKey: "c1" });
    });

    it("autofill-property-facts: data on both outcomes", () => {
        const bad = decodeResult(SAMPLES["autofill-property-facts"], 200, { ok: false, facts: null, reason: "BAD_ADDRESS" }, JSON_CT);
        expect(bad).toEqual({ ok: false, data: { facts: null, reason: "BAD_ADDRESS" } });
        const good = decodeResult(SAMPLES["autofill-property-facts"], 200, { ok: true, facts: { sqft: 900 }, reason: null }, JSON_CT);
        expect(good).toEqual({ ok: true, data: { facts: { sqft: 900 }, reason: null } });
    });

    it("load-scope: data is { scope, results }", () => {
        const results = { "u1:i1": { rating: "ok" } };
        expect(decodeResult(SAMPLES["load-scope"], 200, { ok: true, scope: "u1", results }, JSON_CT)).toEqual({ ok: true, data: { scope: "u1", results } });
        expect(decodeResult(SAMPLES["load-scope"], 200, { ok: false, scope: "u1" }, JSON_CT)).toEqual({ ok: false });
    });

    it("compliance answers carry their echoed key as data", () => {
        expect(decodeResult(SAMPLES["compliance:signoff"], 200, { ok: true, role: "pcr_reviewer" }, JSON_CT).data).toEqual({ role: "pcr_reviewer" });
        expect(decodeResult(SAMPLES["compliance:remove-signoff"], 200, { ok: true, role: "field_observer" }, JSON_CT).data).toEqual({ role: "field_observer" });
        expect(decodeResult(SAMPLES["compliance:doc-review"], 200, { ok: true, documentKey: "d1" }, JSON_CT).data).toEqual({ documentKey: "d1" });
        expect(decodeResult(SAMPLES["compliance:psq-status"], 200, { ok: true, status: "declined" }, JSON_CT).data).toEqual({ status: "declined" });
        expect(decodeResult(SAMPLES["compliance:psq-status"], 200, { ok: false }, JSON_CT)).toEqual({ ok: false });
        expect(decodeResult(SAMPLES["compliance:psq"], 200, { ok: true }, JSON_CT)).toEqual({ ok: true });
    });

    it("a redirected reply or a non-JSON content type is a session expiry", () => {
        expect(decodeResult(SAMPLES.complete, 200, null, { redirected: true, contentType: "text/html" })).toEqual({ ok: false, error: "Session expired" });
        expect(decodeResult(SAMPLES.complete, 200, null, { contentType: "text/html; charset=utf-8" })).toEqual({ ok: false, error: "Session expired" });
        expect(decodeResult(SAMPLES.complete, 200, null, { contentType: null })).toEqual({ ok: false, error: "Session expired" });
    });

    it("any non-2xx is a failure, with the body error when there is one", () => {
        expect(decodeResult(SAMPLES.complete, 500, null, { contentType: "text/plain" })).toEqual({ ok: false, error: "Request failed (500)" });
        expect(decodeResult(SAMPLES.complete, 401, { error: "Unauthorized" }, JSON_CT)).toEqual({ ok: false, error: "Unauthorized" });
        expect(decodeResult(SAMPLES.complete, 302, { ok: true }, JSON_CT).ok).toBe(false);
    });

    it("never throws on malformed input", () => {
        const cmds = Object.values(SAMPLES) as FieldCommand[];
        const bodies: unknown[] = [null, undefined, 5, "x", [], {}, { ok: "yes" }, { ok: true, facts: 3, results: "s", coverKey: 7 }];
        for (const cmd of cmds) {
            for (const body of bodies) {
                const r = decodeResult(cmd, 200, body, JSON_CT);
                expect(typeof r.ok).toBe("boolean");
            }
        }
        // A body whose property access throws.
        const hostile = new Proxy({}, { get() { throw new Error("boom"); } });
        expect(decodeResult(SAMPLES.complete, 200, hostile, JSON_CT)).toEqual({ ok: false, error: "Unreadable response" });
    });
});
