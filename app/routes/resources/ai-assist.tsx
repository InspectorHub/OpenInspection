/**
 * BFF resource route for AI writing assistance on an inspection note (#61).
 *
 * WHY THIS FILE EXISTS AT ALL. `POST /api/ai/comment-assist` has shipped for a
 * long time and nothing in `app/` ever called it — the whole AI feature set was
 * reachable only by an API client. So there was no surface on which a review of
 * model-assisted text could be required, which is why the review table landed
 * before the control that writes to it. This route is the seam that makes both
 * real. A client `fetch('/api/...')` would arrive unauthenticated (the JWT is a
 * server-held cookie relayed by the loader/action), so the browser talks to this
 * route and this route talks to the API.
 *
 * TWO INTENTS, IN A FIXED ORDER, AND THE ORDER IS THE POINT:
 *   `assist` — ask for a rewrite. Returns the text AND the `aiCallId` that
 *              identifies the call inside `ai_call_provenance`.
 *   `review` — record that a named person reviewed that output, citing the id.
 *
 * ⚠️ THE UI MUST NOT LET TEXT INTO THE NOTE UNTIL `review` SUCCEEDS. This route
 * cannot enforce that on its own — it is two requests — but it is stated here
 * because this is where both live, and because the failure it prevents is
 * silent: model-assisted prose sitting in a published report with no record
 * that anyone looked at it, which is the exact gap #61 exists to close.
 *
 * WHAT IS DELIBERATELY NOT HERE: an `aiCallId` supplied by the browser for an
 * `assist` it did not make. The id always comes back from `assist` in the same
 * response as the text, so a client can only cite calls it actually caused.
 * (The REVIEWER is separately never taken from the request — the API reads it
 * from the authenticated user. See `server/api/ai.ts`.)
 */
import type { Route } from "./+types/ai-assist";
import { getToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";

export type AiAssistResult =
    | { ok: true; intent: "assist"; text: string; aiCallId: string }
    | { ok: true; intent: "review" }
    | { ok: false; error: string };

/**
 * The message shown when the API refuses. The server's own refusal text is
 * preferred whenever it sends one: `checkAiCapability` phrases its denial "for
 * the inspector who triggered the call, not for a log", and until now nothing
 * consumed that. This literal is only the fallback for a transport failure,
 * where there is no server message to show.
 */
const GENERIC_FAILURE = "AI writing assistance is unavailable right now.";

/** Pull the API's own error message out of an error envelope, if it sent one.
 *  Typed structurally rather than as `Response`: the hono client hands back a
 *  `ClientResponse<…>`, whose `json()` is narrowed to the success payload, and
 *  the error envelope on a non-ok response is off that contract by definition. */
async function apiErrorMessage(res: { json: () => Promise<unknown> }): Promise<string> {
    try {
        const body = (await res.json()) as { error?: { message?: string } };
        const message = body?.error?.message;
        return typeof message === "string" && message.trim() ? message : GENERIC_FAILURE;
    } catch {
        return GENERIC_FAILURE;
    }
}

export async function action({ request, context }: Route.ActionArgs): Promise<AiAssistResult> {
    const token = await getToken(context, request);
    if (!token) return { ok: false, error: GENERIC_FAILURE };

    const api = createApi(context, { token });
    const form = await request.formData();
    const intent = String(form.get("intent") ?? "");

    try {
        if (intent === "assist") {
            const text = String(form.get("text") ?? "").trim();
            if (!text) return { ok: false, error: GENERIC_FAILURE };
            const itemContext = String(form.get("context") ?? "").trim();
            const res = await api.ai["comment-assist"].$post(
                { json: { text, ...(itemContext ? { context: itemContext } : {}) } },
                { headers: { "x-token-relay": "1" } },
            );
            if (!res.ok) return { ok: false, error: await apiErrorMessage(res) };
            const body = (await res.json()) as { data?: { text?: string; aiCallId?: string } };
            const suggested = body.data?.text;
            const aiCallId = body.data?.aiCallId;
            // Both or neither. A suggestion with no call id could never be
            // reviewed — the review row requires the id and has no "unknown"
            // arm — so handing one to the UI would produce text the inspector
            // is offered and structurally cannot accept.
            if (!suggested || !aiCallId) return { ok: false, error: GENERIC_FAILURE };
            return { ok: true, intent: "assist", text: suggested, aiCallId };
        }

        if (intent === "review") {
            const artifactId = String(form.get("artifactId") ?? "").trim();
            const aiCallId = String(form.get("aiCallId") ?? "").trim();
            if (!artifactId || !aiCallId) return { ok: false, error: GENERIC_FAILURE };
            const res = await api.ai.reviews.$post(
                { json: { artifactType: "inspection_result" as const, artifactId, aiCallId } },
                { headers: { "x-token-relay": "1" } },
            );
            if (!res.ok) return { ok: false, error: await apiErrorMessage(res) };
            return { ok: true, intent: "review" };
        }

        return { ok: false, error: GENERIC_FAILURE };
    } catch {
        return { ok: false, error: GENERIC_FAILURE };
    }
}
