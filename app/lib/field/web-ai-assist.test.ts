import { describe, expect, it, vi } from "vitest";
import type { AiAssistInput } from "@core/field-ui/data-source-types";
import { AI_ASSIST_ROUTE, AI_ASSIST_UNAVAILABLE, createWebAiAssist } from "./web-ai-assist";

function json(body: unknown, init: ResponseInit = {}): Response {
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
}

const ASSIST: AiAssistInput = { intent: "assist", payload: { text: "roof bad", context: "Roof - Covering" } };
const REVIEW: AiAssistInput = { intent: "review", payload: { artifactId: "res-1", aiCallId: "call-1" } };

const run = (input: AiAssistInput, respond: () => Promise<Response>) =>
    createWebAiAssist(respond as unknown as typeof fetch).run(input);

describe("createWebAiAssist request", () => {
    it("posts the form the panel fetcher used to submit: urlencoded, the route field names, the session cookie", async () => {
        const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => json({ ok: true, intent: "assist", text: "t", aiCallId: "c" }));
        await createWebAiAssist(fetchImpl as unknown as typeof fetch).run(ASSIST);
        const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe("/resources/ai-assist");
        expect(url).toBe(AI_ASSIST_ROUTE);
        expect(init.method).toBe("POST");
        expect(init.credentials).toBe("include");
        const body = init.body as URLSearchParams;
        expect(body).toBeInstanceOf(URLSearchParams);
        expect(Object.fromEntries(body)).toEqual({ intent: "assist", text: "roof bad", context: "Roof - Covering" });
    });

    it("sends an empty context when there is none, as the panel did", async () => {
        const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => json({ ok: true, intent: "assist", text: "t", aiCallId: "c" }));
        await createWebAiAssist(fetchImpl as unknown as typeof fetch).run({ intent: "assist", payload: { text: "x" } });
        const init = fetchImpl.mock.calls[0]![1] as unknown as RequestInit;
        expect((init.body as URLSearchParams).get("context")).toBe("");
    });

    it("posts a review with the artifact and the call it cites, and no key header", async () => {
        const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => json({ ok: true, intent: "review" }));
        await createWebAiAssist(fetchImpl as unknown as typeof fetch).run(REVIEW);
        const init = fetchImpl.mock.calls[0]![1] as unknown as RequestInit;
        expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({
            intent: "review",
            artifactId: "res-1",
            aiCallId: "call-1",
        });
        expect(Object.keys((init.headers ?? {}) as Record<string, string>).map((k) => k.toLowerCase())).not.toContain("idempotency-key");
    });
});

describe("createWebAiAssist answer", () => {
    it("an assist carries the text AND the id of the call that produced it", async () => {
        const result = await run(ASSIST, async () => json({ ok: true, intent: "assist", text: "Better.", aiCallId: "call-9" }));
        expect(result).toEqual({ ok: true, intent: "assist", text: "Better.", aiCallId: "call-9" });
    });

    it("a review answers ok only for a review answer", async () => {
        expect(await run(REVIEW, async () => json({ ok: true, intent: "review" }))).toEqual({ ok: true, intent: "review" });
    });

    it("relays the route own sentence when it refuses", async () => {
        const result = await run(ASSIST, async () => json({ ok: false, error: "Plan does not include AI." }));
        expect(result).toEqual({ ok: false, error: "Plan does not include AI." });
    });

    it("FAILS CLOSED on an answer that is not the shape the intent calls for", async () => {
        const cases: Array<[AiAssistInput, unknown]> = [
            // an assist with no call id can never be reviewed
            [ASSIST, { ok: true, intent: "assist", text: "t" }],
            [ASSIST, { ok: true, intent: "assist", aiCallId: "c" }],
            [ASSIST, { ok: true, intent: "assist", text: "", aiCallId: "c" }],
            // the other intent's answer
            [ASSIST, { ok: true, intent: "review" }],
            [REVIEW, { ok: true, intent: "assist", text: "t", aiCallId: "c" }],
            // a review answer that does not say it is one
            [REVIEW, { ok: true }],
            [REVIEW, { ok: "true", intent: "review" }],
            [REVIEW, "ok"],
            [REVIEW, null],
        ];
        for (const [input, body] of cases) {
            const result = await run(input, async () => json(body));
            expect(result, JSON.stringify(body)).toEqual({ ok: false, error: AI_ASSIST_UNAVAILABLE });
        }
    });

    it("never throws: a bad status, a session-expiry page, a redirect and a network error are all { ok: false }", async () => {
        const cases: Array<[() => Promise<Response>, string]> = [
            [async () => json({ ok: true, intent: "review" }, { status: 500 }), AI_ASSIST_UNAVAILABLE],
            [async () => json({ error: "Internal server error" }, { status: 503 }), "Internal server error"],
            [async () => new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } }), "Session expired"],
            [
                async () => {
                    const res = new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } });
                    Object.defineProperty(res, "redirected", { value: true });
                    return res;
                },
                "Session expired",
            ],
            [
                async () => {
                    throw new Error("offline");
                },
                "offline",
            ],
        ];
        for (const [respond, error] of cases) {
            expect(await run(REVIEW, respond)).toEqual({ ok: false, error });
        }
    });
});
