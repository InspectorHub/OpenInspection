/**
 * The web host's `resources.aiAssist`: AI writing assistance for an inspection note, over the BFF
 * resource route `/resources/ai-assist` (action = POST an `intent` of `assist` or `review`).
 *
 * It never throws and it fails closed. A request is answered `ok: true` only when the route's JSON
 * has the shape the INTENT it sent calls for: `assist` needs both the text and the id of the call
 * that produced it, `review` needs the review's own `ok` answer with `intent: "review"`. Anything else
 * (a bad status, a session-expiry page, a body of the other intent, a network error) is
 * `{ ok: false, error }`. That matters most for `review`: it is the answer that lets model-assisted
 * text into a note.
 *
 * The request is the one the panel's fetcher used to submit: urlencoded, with the same field names the
 * route reads.
 */
import type { AiAssistInput, AiAssistResult } from "@core/field-ui/data-source-types";
import type { FieldResources } from "@core/field-ui/data-source";

export const AI_ASSIST_ROUTE = "/resources/ai-assist";

/** The route's own sentence for a failure it cannot explain; used when the reply carries none. */
export const AI_ASSIST_UNAVAILABLE = "AI writing assistance is unavailable right now.";

type AiAssist = NonNullable<FieldResources["aiAssist"]>;

function formOf(input: AiAssistInput): URLSearchParams {
    if (input.intent === "assist") {
        return new URLSearchParams({ intent: "assist", text: input.payload.text, context: input.payload.context ?? "" });
    }
    return new URLSearchParams({
        intent: "review",
        artifactId: input.payload.artifactId,
        aiCallId: input.payload.aiCallId,
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): string | undefined {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}

function decode(input: AiAssistInput, body: unknown): AiAssistResult {
    if (!isRecord(body)) return { ok: false, error: AI_ASSIST_UNAVAILABLE };
    if (body.ok !== true) return { ok: false, error: nonEmpty(body.error) ?? AI_ASSIST_UNAVAILABLE };
    if (input.intent === "assist") {
        const text = nonEmpty(body.text);
        const aiCallId = nonEmpty(body.aiCallId);
        if (body.intent !== "assist" || text === undefined || aiCallId === undefined) {
            return { ok: false, error: AI_ASSIST_UNAVAILABLE };
        }
        return { ok: true, intent: "assist", text, aiCallId };
    }
    return body.intent === "review" ? { ok: true, intent: "review" } : { ok: false, error: AI_ASSIST_UNAVAILABLE };
}

export function createWebAiAssist(fetchImpl: typeof fetch = (input, init) => fetch(input, init)): AiAssist {
    return {
        async run(input: AiAssistInput): Promise<AiAssistResult> {
            try {
                // busy-controls-allow: the caller (AiAssistPanel) holds the same-frame guard (one request in flight per panel); this sends exactly the request it asked for
                const res = await fetchImpl(AI_ASSIST_ROUTE, {
                    method: "POST",
                    credentials: "include",
                    headers: { accept: "application/json" },
                    body: formOf(input),
                });
                if (res.redirected) return { ok: false, error: "Session expired" };
                const isJson = res.headers.get("content-type")?.toLowerCase().includes("json") === true;
                const body: unknown = isJson ? await res.json().catch(() => null) : null;
                if (!res.ok) return { ok: false, error: (isRecord(body) ? nonEmpty(body.error) : undefined) ?? AI_ASSIST_UNAVAILABLE };
                // A 200 that is not JSON is the sign-in page a session expiry redirects to.
                if (!isJson) return { ok: false, error: "Session expired" };
                return decode(input, body);
            } catch (err) {
                return { ok: false, error: err instanceof Error && err.message ? err.message : "Network error" };
            }
        },
    };
}
