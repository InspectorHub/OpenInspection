import { describe, expect, it, vi } from "vitest";
import { DEFAULT_INSPECTION_PREFS } from "@core/field-ui/hooks/useInspectionPrefs";
import { createWebPrefs, PREFS_ROUTE } from "./web-prefs";

const PREFS = { ...DEFAULT_INSPECTION_PREFS, autoAdvance: "off" as const, pinnedTagIds: ["t1"] };

function json(body: unknown, init: ResponseInit = {}): Response {
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
}

describe("createWebPrefs.load", () => {
    it("GETs the resource route with the session cookie and returns the loader's prefs", async () => {
        const fetchImpl = vi.fn(async () => json({ prefs: PREFS }));
        const prefs = await createWebPrefs(fetchImpl as unknown as typeof fetch).load();
        expect(prefs).toEqual(PREFS);
        const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe("/resources/inspection-prefs");
        expect(url).toBe(PREFS_ROUTE);
        expect(init.credentials).toBe("include");
        expect(init.method).toBeUndefined();
    });

    it("answers the defaults when the route says no prefs, fails, redirects or throws", async () => {
        const cases: Array<() => Promise<Response>> = [
            async () => json({ prefs: null }),
            async () => json({}, { status: 500 }),
            async () => new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } }),
            async () => {
                throw new Error("offline");
            },
        ];
        for (const respond of cases) {
            await expect(createWebPrefs(respond as unknown as typeof fetch).load()).resolves.toEqual(DEFAULT_INSPECTION_PREFS);
        }
    });
});

describe("createWebPrefs.patch", () => {
    it("POSTs the same form the fetcher did: urlencoded, one field `patch` holding the JSON delta", async () => {
        const fetchImpl = vi.fn(async () => json({ ok: true, prefs: PREFS }));
        const result = await createWebPrefs(fetchImpl as unknown as typeof fetch).patch({ autoAdvance: "off" });
        expect(result).toEqual({ ok: true, data: PREFS });
        const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe("/resources/inspection-prefs");
        expect(init.method).toBe("POST");
        expect(init.credentials).toBe("include");
        const body = init.body as URLSearchParams;
        expect(body).toBeInstanceOf(URLSearchParams);
        expect([...body.keys()]).toEqual(["patch"]);
        expect(JSON.parse(body.get("patch") ?? "")).toEqual({ autoAdvance: "off" });
    });

    it("never throws: a not-ok action, a bad status, a session-expiry page and a network error are all { ok: false }", async () => {
        const cases: Array<() => Promise<Response>> = [
            async () => json({ ok: false, prefs: null }),
            async () => json({ ok: true, prefs: PREFS }, { status: 500 }),
            async () => new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } }),
            async () => {
                throw new Error("offline");
            },
        ];
        for (const respond of cases) {
            const result = await createWebPrefs(respond as unknown as typeof fetch).patch({ autoAdvance: "off" });
            expect(result.ok).toBe(false);
            expect(typeof result.error).toBe("string");
        }
    });

    it("an ok answer with no echo is still ok, carrying no data", async () => {
        const result = await createWebPrefs((async () => json({ ok: true, prefs: null })) as unknown as typeof fetch).patch({});
        expect(result).toEqual({ ok: true });
    });
});
