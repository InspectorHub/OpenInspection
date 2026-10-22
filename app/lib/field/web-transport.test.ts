// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { IDEMPOTENCY_FIELD } from "~/hooks/useGuardedSubmit";
import { createWebExecute } from "./web-transport";
import { SAMPLES } from "./web-commands.fixtures";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
    return Response.json(body, init);
}

describe("createWebExecute", () => {
    it("POSTs the encoded form to the resource route with credentials and decodes the answer", async () => {
        const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ ok: true, intent: "set-cover" }));
        const execute = createWebExecute({ fetchImpl });
        const result = await execute("insp 1", SAMPLES["set-cover"]);
        expect(result).toEqual({ ok: true });
        const [url, init] = fetchImpl.mock.calls[0]!;
        expect(url).toBe("/resources/inspection-editor-command/insp%201");
        expect(init?.method).toBe("POST");
        expect(init?.credentials).toBe("include");
        const form = init?.body as FormData;
        expect(form.get("intent")).toBe("set-cover");
        expect(form.get("coverPhotoId")).toBe("k1");
    });

    it("sends the idempotency key as a form field only when given, and never as a header", async () => {
        const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse({ ok: true }));
        const execute = createWebExecute({ fetchImpl });

        await execute("i", SAMPLES.complete, { idempotencyKey: "key-1" });
        await execute("i", SAMPLES.complete);
        await execute("i", SAMPLES.complete, {});

        const [withKey, without, emptyOpts] = fetchImpl.mock.calls.map(([, init]) => init!);
        expect((withKey!.body as FormData).get(IDEMPOTENCY_FIELD)).toBe("key-1");
        expect((without!.body as FormData).has(IDEMPOTENCY_FIELD)).toBe(false);
        expect((emptyOpts!.body as FormData).has(IDEMPOTENCY_FIELD)).toBe(false);
        for (const init of [withKey!, without!, emptyOpts!]) {
            const headers = new Headers(init.headers);
            expect(headers.has("idempotency-key")).toBe(false);
        }
    });

    it("honours a custom endpoint", async () => {
        const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ ok: true }));
        await createWebExecute({ fetchImpl, endpoint: (id) => `/x/${id}` })("a", SAMPLES.complete);
        expect(fetchImpl.mock.calls[0]![0]).toBe("/x/a");
    });

    it("turns a network rejection or an abort into a failed result and never throws", async () => {
        const reject = createWebExecute({ fetchImpl: vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch")) });
        await expect(reject("i", SAMPLES.complete)).resolves.toEqual({ ok: false, error: "Failed to fetch" });
        const abort = createWebExecute({ fetchImpl: vi.fn<typeof fetch>().mockRejectedValue(new DOMException("aborted", "AbortError")) });
        await expect(abort("i", SAMPLES.complete)).resolves.toMatchObject({ ok: false });
        const odd = createWebExecute({ fetchImpl: vi.fn<typeof fetch>().mockRejectedValue("nope") });
        await expect(odd("i", SAMPLES.complete)).resolves.toEqual({ ok: false, error: "Network error" });
    });

    it("maps an HTML 200 to session expiry and a 500 to a failure", async () => {
        const html = new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } });
        const expired = await createWebExecute({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(html) })("i", SAMPLES.complete);
        expect(expired).toEqual({ ok: false, error: "Session expired" });
        const boom = new Response("Unexpected Server Error", { status: 500, headers: { "content-type": "text/plain" } });
        const failed = await createWebExecute({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(boom) })("i", SAMPLES.complete);
        expect(failed).toEqual({ ok: false, error: "Request failed (500)" });
    });

    it("survives a JSON content type with an unparsable body", async () => {
        const bad = new Response("{not json", { status: 200, headers: { "content-type": "application/json" } });
        const r = await createWebExecute({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(bad) })("i", SAMPLES.complete);
        expect(r.ok).toBe(false);
    });
});

describe("createWebExecute with no inspection id", () => {
    it("answers a failure without sending a request that could only 404", async () => {
        const fetchImpl = vi.fn<typeof fetch>();
        const result = await createWebExecute({ fetchImpl })("", SAMPLES.complete);
        expect(result).toEqual({ ok: false, error: "No inspection id" });
        expect(fetchImpl).not.toHaveBeenCalled();
    });
});

describe("createWebExecute with a stalled connection", () => {
    it("abandons a request that never settles and answers a failure, so a queue of writes cannot wedge behind it", async () => {
        // A fetch that honours the abort signal and otherwise never answers.
        const fetchImpl = vi.fn<typeof fetch>().mockImplementation(
            (_url, init) =>
                new Promise((_resolve, reject) => {
                    init?.signal?.addEventListener("abort", () => reject(new DOMException("The operation timed out.", "TimeoutError")));
                }),
        );
        const result = await createWebExecute({ fetchImpl, timeoutMs: 30 })("insp-1", SAMPLES.complete);
        expect(result.ok).toBe(false);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(fetchImpl.mock.calls[0]?.[1]?.signal).toBeDefined();
    });

    it("gives a command that uploads an image a longer default limit than a plain one", async () => {
        const seen: number[] = [];
        const spy = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
            seen.push(ms);
            return new AbortController().signal;
        });
        try {
            const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ ok: true }));
            const execute = createWebExecute({ fetchImpl });
            await execute("insp-1", SAMPLES.complete);
            await execute("insp-1", SAMPLES["upload-cover"]);
            expect(seen).toHaveLength(2);
            expect(seen[1]!).toBeGreaterThan(seen[0]!);
        } finally {
            spy.mockRestore();
        }
    });
});
