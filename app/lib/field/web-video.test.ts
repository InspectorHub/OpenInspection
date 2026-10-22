import { describe, expect, it, vi } from "vitest";
import type { VideoUploadTicket } from "@core/field-ui/data-source-types";
import { apiErrorReason, createWebVideo, posterRoute, uploadWithProgressBody } from "./web-video";

const ok = (body: unknown = { success: true }) =>
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const asFetch = (fn: unknown) => fn as typeof fetch;

describe("createWebVideo.setPoster", () => {
    it("POSTs the poster endpoint with the same JSON body the picker's fetcher sent", async () => {
        const fetchImpl = vi.fn(async () => ok());
        const result = await createWebVideo(asFetch(fetchImpl)).setPoster("insp-1", { streamUid: "uid-1", posterPct: 0.25 });
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
            const result = await createWebVideo(asFetch(respond)).setPoster("i", { streamUid: "u", posterPct: 0 });
            expect(result.ok).toBe(false);
            expect(typeof result.error).toBe("string");
        }
    });
});

describe("createWebVideo.createUpload", () => {
    const TICKET: VideoUploadTicket = { uploadURL: "/up?token=t", provider: "r2", ref: { provider: "r2", mediaId: "m", r2Key: "k.mp4" } };

    it("POSTs create-upload with the item id, or an empty body without one, and answers the ticket", async () => {
        const fetchImpl = vi.fn(async () => ok({ data: TICKET }));
        const video = createWebVideo(asFetch(fetchImpl));
        expect(await video.createUpload("i1", { itemId: "it" })).toEqual({ ok: true, data: TICKET });
        await video.createUpload("i1", {});
        const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe("/api/inspections/i1/media/video/create-upload");
        expect(init.method).toBe("POST");
        expect(JSON.parse(init.body as string)).toEqual({ itemId: "it" });
        expect(JSON.parse((fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1].body as string)).toEqual({});
    });

    it("answers the API's reason, a status-coded sentence, or the unexpected-response sentence", async () => {
        const quota = await createWebVideo(asFetch(async () => new Response(JSON.stringify({ error: { message: "No quota left" } }), { status: 503 }))).createUpload("i", {});
        expect(quota).toEqual({ ok: false, error: "No quota left" });
        const coded = await createWebVideo(asFetch(async () => new Response("{}", { status: 500 }))).createUpload("i", {});
        expect(coded.error).toMatch(/500/);
        const empty = await createWebVideo(asFetch(async () => ok({ data: {} }))).createUpload("i", {});
        expect(empty.ok).toBe(false);
        expect(empty.error).toMatch(/unexpected/i);
        const offline = await createWebVideo(asFetch(async () => { throw new Error("offline"); })).createUpload("i", {});
        expect(offline.ok).toBe(false);
        expect(typeof offline.error).toBe("string");
    });
});

describe("createWebVideo.finalize and uploadPoster", () => {
    it("finalize POSTs the reference as JSON and answers the pool row id", async () => {
        const fetchImpl = vi.fn(async () => ok({ data: { poolId: "pool-9" } }));
        const result = await createWebVideo(asFetch(fetchImpl)).finalize("i1", { provider: "stream", streamUid: "u" });
        expect(result).toEqual({ ok: true, data: { poolId: "pool-9" } });
        const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe("/api/inspections/i1/media/video/finalize");
        expect(JSON.parse(init.body as string)).toEqual({ provider: "stream", streamUid: "u" });
    });

    it("finalize answers the API's reason when it refuses", async () => {
        const refused = new Response(JSON.stringify({ error: { message: "Too late" } }), { status: 409 });
        expect(await createWebVideo(asFetch(async () => refused)).finalize("i", { provider: "stream", streamUid: "u" })).toEqual({ ok: false, error: "Too late" });
    });

    it("uploadPoster reuses the upload token from the upload URL and answers the poster key", async () => {
        const fetchImpl = vi.fn(async () => ok({ data: { posterKey: "pk" } }));
        const ticket: VideoUploadTicket = { uploadURL: "https://h.example/up?token=a%20b", provider: "r2", ref: { provider: "r2", mediaId: "m", r2Key: "k" } };
        const result = await createWebVideo(asFetch(fetchImpl)).uploadPoster("i1", ticket, new Blob(["x"]));
        expect(result).toEqual({ ok: true, data: { posterKey: "pk" } });
        const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe("/api/inspections/i1/media/video/r2-upload-poster?token=a%20b");
        expect((init.body as FormData).get("file")).toBeInstanceOf(Blob);
        expect(await createWebVideo(asFetch(async () => new Response("{}", { status: 500 }))).uploadPoster("i", ticket, new Blob())).toEqual({ ok: false });
    });
});

describe("createWebVideo.uploadFile", () => {
    class FakeXhr {
        static last: FakeXhr | null = null;
        static status = 200;
        static text = "";
        upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        status = FakeXhr.status;
        responseText = FakeXhr.text;
        withCredentials = false;
        url = "";
        open(_method: string, url: string) { this.url = url; FakeXhr.last = this; }
        send() {
            this.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 4 });
            queueMicrotask(() => this.onload?.());
        }
    }
    const withXhr = async <T,>(status: number, text: string, run: () => Promise<T>): Promise<T> => {
        vi.stubGlobal("XMLHttpRequest", FakeXhr);
        FakeXhr.status = status;
        FakeXhr.text = text;
        try {
            return await run();
        } finally {
            vi.unstubAllGlobals();
        }
    };

    it("r2: sends with credentials, reports progress and answers the real media id and key", async () => {
        const seen: number[] = [];
        const ticket: VideoUploadTicket = { uploadURL: "/up", provider: "r2", ref: { provider: "r2", mediaId: "placeholder", r2Key: "placeholder.mp4" } };
        const result = await withXhr(200, JSON.stringify({ data: { mediaId: "m1", r2Key: "k1.webm" } }), () =>
            createWebVideo().uploadFile(ticket, new Blob(["x"]), (p) => seen.push(p)));
        expect(result).toEqual({ ok: true, data: { mediaId: "m1", r2Key: "k1.webm" } });
        expect(FakeXhr.last?.withCredentials).toBe(true);
        expect(seen).toEqual([25]);
    });

    it("r2: an answer without the media id and key is the unexpected-response failure", async () => {
        const ticket: VideoUploadTicket = { uploadURL: "/up", provider: "r2", ref: { provider: "r2", mediaId: "p", r2Key: "p" } };
        const result = await withXhr(200, "not json", () => createWebVideo().uploadFile(ticket, new Blob(), () => undefined));
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/unexpected/i);
    });

    it("stream: goes straight to the upload URL without credentials and answers no data; a bad status fails", async () => {
        const ticket: VideoUploadTicket = { uploadURL: "https://cf.example/up", provider: "stream", ref: { provider: "stream", streamUid: "u" } };
        expect(await withXhr(200, "", () => createWebVideo().uploadFile(ticket, new Blob(), () => undefined))).toEqual({ ok: true });
        expect(FakeXhr.last?.withCredentials).toBe(false);
        const failed = await withXhr(500, "", () => createWebVideo().uploadFile(ticket, new Blob(), () => undefined));
        expect(failed.ok).toBe(false);
        expect(failed.error).toMatch(/upload/i);
    });

    it("exports the progress uploader", () => {
        expect(typeof uploadWithProgressBody).toBe("function");
    });
});

describe("apiErrorReason", () => {
    const res = (status: number, body: unknown): Response => ({ status, json: async () => body }) as unknown as Response;
    it("surfaces the server-provided reason from the { error: { message } } envelope", async () => {
        await expect(apiErrorReason(res(503, { error: { message: "Video uploads are unavailable: no remaining storage quota." } }))).resolves.toMatch(/no remaining storage quota/i);
    });
    it("falls back to a status-coded message when the envelope has no usable reason or the body is not JSON", async () => {
        await expect(apiErrorReason(res(500, { success: false }))).resolves.toMatch(/\(500\)/);
        const notJson = { status: 502, json: async () => { throw new Error("not json"); } } as unknown as Response;
        await expect(apiErrorReason(notJson)).resolves.toMatch(/\(502\)/);
    });
});

describe("createWebVideo.remove", () => {
    it("stays loudly unwired instead of silently doing nothing", async () => {
        const result = await createWebVideo(asFetch(async () => ok())).remove("i", "r");
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/not wired/);
    });
});
