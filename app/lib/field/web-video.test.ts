import { describe, expect, it, vi } from "vitest";
import { createWebVideo, posterRoute } from "./web-video";

const ok = () => new Response(JSON.stringify({ success: true }), { status: 200, headers: { "content-type": "application/json" } });

describe("createWebVideo.setPoster", () => {
    it("POSTs the poster endpoint with the same JSON body the picker's fetcher sent", async () => {
        const fetchImpl = vi.fn(async () => ok());
        const result = await createWebVideo(fetchImpl as unknown as typeof fetch).setPoster("insp-1", { streamUid: "uid-1", posterPct: 0.25 });
        expect(result).toEqual({ ok: true });
        const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe("/api/inspections/insp-1/media/video/poster");
        expect(url).toBe(posterRoute("insp-1"));
        expect(init.method).toBe("POST");
        expect(init.credentials).toBe("include");
        expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
        expect(JSON.parse(init.body as string)).toEqual({ streamUid: "uid-1", posterPct: 0.25 });
        expect(Object.keys(JSON.parse(init.body as string))).toEqual(["streamUid", "posterPct"]);
    });

    it("never throws: a bad status, a session-expiry redirect and a network error are all { ok: false }", async () => {
        const redirected = () => {
            const res = new Response("<html></html>", { status: 200 });
            Object.defineProperty(res, "redirected", { value: true });
            return res;
        };
        const cases: Array<() => Promise<Response>> = [
            async () => new Response("{}", { status: 500 }),
            async () => new Response("{}", { status: 403 }),
            async () => redirected(),
            async () => {
                throw new Error("offline");
            },
        ];
        for (const respond of cases) {
            const result = await createWebVideo(respond as unknown as typeof fetch).setPoster("i", { streamUid: "u", posterPct: 0 });
            expect(result.ok).toBe(false);
            expect(typeof result.error).toBe("string");
        }
    });

    it("leaves the capture members loudly unwired instead of silently doing nothing", async () => {
        const video = createWebVideo((async () => ok()) as unknown as typeof fetch);
        await expect(video.createUpload("i")).rejects.toThrow(/not wired/);
        for (const result of [await video.uploadPoster("i", new Blob()), await video.finalize("i", {}), await video.remove("i", "r")]) {
            expect(result.ok).toBe(false);
            expect(result.error).toMatch(/not wired/);
        }
    });
});
