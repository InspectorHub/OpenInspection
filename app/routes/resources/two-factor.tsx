/**
 * BFF resource route for the Settings → Security two-factor panel.
 *
 * The five TOTP endpoints have existed since they were written and no screen
 * ever called one: the panel's Enable, Regenerate and Disable were `<button>`
 * elements with no `onClick`, so 2FA read as available and could not be turned
 * on. This route is the missing half.
 *
 * It has to be a resource route rather than a `fetch('/api/...')`: a browser
 * request to the API carries no session (token-relay BFF), so client-side
 * calls would answer 401 no matter what the user did.
 *
 * ⚠️ SECRETS PASS THROUGH HERE. The setup response carries the TOTP secret and
 * the recovery codes in clear, once, because that is the only moment they can
 * be shown. They are returned to the caller and never logged, never persisted
 * by this route, and never put in a URL.
 */
import type { Route } from "./+types/two-factor";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";

type SetupPayload = { secret: string; qrCodeDataUri: string; recoveryCodes: string[] };

/**
 * What the API said, in the words a person should see.
 *
 * Typed structurally, not as `Response`: `hono/client` hands back a
 * `ClientResponse`, which carries the status and `json()` this needs but not
 * the whole DOM interface (it has no `webSocket`, for one).
 */
async function failure(res: { status: number; json: () => Promise<unknown> }): Promise<string> {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } | string } | null;
    const msg = typeof body?.error === "string" ? body.error : body?.error?.message;
    return msg || `Request failed (${res.status})`;
}

export async function action({ request, context }: Route.ActionArgs) {
    const token = await requireToken(context, request);
    const api = createApi(context, { token });
    const fd = await request.formData();
    const intent = fd.get("intent");
    const code = String(fd.get("code") ?? "").trim();
    const password = String(fd.get("password") ?? "");

    try {
        if (intent === "setup") {
            const res = await api.auth["2fa"].setup.$post();
            if (!res.ok) return { ok: false as const, intent, error: await failure(res) };
            const body = (await res.json()) as { data?: SetupPayload };
            return { ok: true as const, intent, setup: body.data ?? null };
        }

        if (intent === "verify") {
            const res = await api.auth["2fa"].verify.$post({ json: { code } });
            if (!res.ok) return { ok: false as const, intent, error: await failure(res) };
            return { ok: true as const, intent };
        }

        if (intent === "disable") {
            const res = await api.auth["2fa"].disable.$post({ json: { password, code } });
            if (!res.ok) return { ok: false as const, intent, error: await failure(res) };
            return { ok: true as const, intent };
        }

        if (intent === "regenerate") {
            const res = await api.auth["2fa"]["recovery-codes"].regenerate.$post({ json: { password, code } });
            if (!res.ok) return { ok: false as const, intent, error: await failure(res) };
            const body = (await res.json()) as { data?: SetupPayload };
            // Same shape as setup, and deliberately so — the caller shows the
            // new codes with the same component that shows the first set.
            return { ok: true as const, intent, setup: body.data ?? null };
        }

        return { ok: false as const, intent, error: "Unknown action" };
    } catch {
        // A network failure must not read as a rejected code: one is worth
        // retrying unchanged, the other is not.
        return { ok: false as const, intent, error: "Connection error. Please try again." };
    }
}
