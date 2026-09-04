/**
 * BFF resource route for the discount-codes panel.
 *
 * `PUT /api/services/discount-codes/{id}` has existed since it was written and
 * the panel called nothing — every row's "Edit" was a `<button>` with no
 * `onClick`, so a code could be created and then never changed or switched
 * off.
 *
 * A resource route rather than a new intent on `/settings/services`: the panel
 * is a component, the page's action is already nine intents long and the file
 * sits near its size ceiling, and a browser `fetch('/api/…')` carries no
 * session under the token-relay BFF.
 *
 * ⚠️ UNITS. `value` is an integer in the code's own terms: for `percent` it is
 * a whole percentage, for `fixed` it is CENTS — the panel renders fixed codes
 * as `value / 100`. A form that took dollars and forwarded them would turn a
 * $50 discount into $0.50 and report success, so the conversion happens here,
 * once, and is what the spec beside this file pins.
 */
import type { Route } from "./+types/discount-codes";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";

/** Dollars (as typed) → cents (as stored). Percent passes through untouched. */
export function toStoredValue(type: string, typed: string): number | null {
    // Explicitly, before Number(): `Number('')` and `Number('  ')` are BOTH 0,
    // so a blank amount would otherwise pass as a zero discount rather than as
    // "you did not enter an amount".
    if (typed.trim() === "") return null;
    const n = Number(typed);
    if (!Number.isFinite(n) || n < 0) return null;
    if (type === "percent") return Number.isInteger(n) ? n : null;
    // Rounded, not truncated: 12.345 typed by a person means 12.35, and
    // `Math.trunc` would quietly discount a cent less than the screen said.
    return Math.round(n * 100);
}

async function failure(res: { status: number; json: () => Promise<unknown> }): Promise<string> {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } | string } | null;
    const msg = typeof body?.error === "string" ? body.error : body?.error?.message;
    return msg || `Request failed (${res.status})`;
}

export async function action({ request, context }: Route.ActionArgs) {
    const token = await requireToken(context, request);
    const api = createApi(context, { token });
    const form = await request.formData();

    const id = String(form.get("id") ?? "");
    if (!id) return { ok: false as const, error: "Missing discount code id" };

    const intent = form.get("intent");

    // The switch on its own. Sending the whole form for a toggle would let a
    // stale value field ride along and change the amount as a side effect of
    // enabling a code.
    if (intent === "toggle") {
        const res = await api.services["discount-codes"][":id"].$put({
            param: { id },
            json: { active: form.get("active") === "true" },
        });
        if (!res.ok) return { ok: false as const, error: await failure(res) };
        return { ok: true as const };
    }

    const type = String(form.get("type") ?? "");
    if (type !== "percent" && type !== "fixed") {
        return { ok: false as const, error: "Choose a discount type" };
    }

    const value = toStoredValue(type, String(form.get("value") ?? ""));
    if (value === null) {
        return {
            ok: false as const,
            error: type === "percent"
                ? "Enter a whole number of percent"
                : "Enter an amount, for example 50 or 49.99",
        };
    }

    const code = String(form.get("code") ?? "").trim();
    if (!code) return { ok: false as const, error: "Enter a code" };

    // `maxUses` and `expiresAt` are NULLABLE on update: an empty field means
    // "no limit" / "never expires", and omitting the key would instead keep
    // whatever was there while the person watched themselves clear it.
    const maxUsesRaw = String(form.get("maxUses") ?? "").trim();
    const maxUses = maxUsesRaw === "" ? null : Number(maxUsesRaw);
    if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 0)) {
        return { ok: false as const, error: "Uses must be a whole number, or blank for no limit" };
    }
    const expiresRaw = String(form.get("expiresAt") ?? "").trim();

    try {
        const res = await api.services["discount-codes"][":id"].$put({
            param: { id },
            json: {
                code,
                type,
                value,
                maxUses,
                expiresAt: expiresRaw === "" ? null : expiresRaw,
                active: form.get("active") === "true",
            },
        });
        if (!res.ok) return { ok: false as const, error: await failure(res) };
        return { ok: true as const };
    } catch {
        return { ok: false as const, error: "Connection error. Please try again." };
    }
}
