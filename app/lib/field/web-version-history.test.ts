import { describe, expect, it } from "vitest";
import { createWebVersionHistory } from "./web-version-history";

const asFetch = (fn: unknown) => fn as typeof fetch;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("createWebVersionHistory failures", () => {
    it("a restore that cannot be sent answers a translated sentence, not the browser's English text", async () => {
        const history = createWebVersionHistory(asFetch(async () => { throw new TypeError("Failed to fetch"); }));
        const result = await history.restore("i1", 3);
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/connection/i);
        expect(result.error).not.toMatch(/Failed to fetch/);
        expect(result.error).not.toBe("Network error");
    });

    it("a capture that cannot be sent answers the same translated sentence", async () => {
        const history = createWebVersionHistory(asFetch(async () => { throw new TypeError("offline"); }));
        const result = await history.capture("i1");
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/connection/i);
    });

    it("a refused restore carries the API's own sentence, else the translated restore-failed one (no HTTP status text)", async () => {
        const withSentence = await createWebVersionHistory(asFetch(async () => json(409, { error: "Too old" }))).restore("i1", 1);
        expect(withSentence).toEqual({ ok: false, error: "Too old" });
        const without = await createWebVersionHistory(asFetch(async () => json(500, {}))).restore("i1", 1);
        expect(without).toEqual({ ok: false, error: "Restore failed" });
    });

    it("a refused capture answers a translated sentence, never an HTTP status", async () => {
        const result = await createWebVersionHistory(asFetch(async () => json(500, {}))).capture("i1");
        expect(result).toEqual({ ok: false, error: "Couldn't save a version" });
    });

    it("reads fail without a sentence (the panel shows its retry)", async () => {
        const history = createWebVersionHistory(asFetch(async () => json(500, {})));
        expect(await history.list("i1")).toEqual({ ok: false });
        expect(await history.get("i1", 1)).toEqual({ ok: false });
    });
});
