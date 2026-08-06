/**
 * Settings → Services, pay-rule reads and writes (#278).
 *
 * Lives beside the route rather than inside it for the same reason the
 * qualification widget's panel does: `settings-services.tsx` is a 336-line file
 * under a 400-line ratchet, and a fourth intent with a create/update fork would
 * have taken it over. Extracting the BFF half keeps the route a router.
 *
 * The unit contract is the thing to hold on to here. Everything below the
 * widget speaks the API's units — basis points and integer cents — and the
 * form fields arrive ALREADY converted (`toHundredths` runs in the widget,
 * beside the "%" and "$" a person can see). Nothing in this file multiplies by
 * a hundred, and nothing in it should start to: two conversion sites is how one
 * of them gets applied twice.
 */
import type { createApi } from "~/lib/api-client.server";
import type { PayRule } from "~/components/settings/services/PayRuleWidget";
import { m } from "~/paraglide/messages";

type Api = ReturnType<typeof createApi>;

export interface PayRuleActionResult {
    ok: boolean;
    intent: "pay-rule-save" | "pay-rule-delete";
    serviceId: string;
    message?: string;
}

/**
 * One GET per service, matching how `restrictionMap` is already built on this
 * page. A tenant has a handful of catalogue services; a bulk endpoint is the
 * fix if that ever stops being true, for both maps at once.
 */
export async function loadPayRuleMap(api: Api, serviceIds: string[]): Promise<Record<string, PayRule[]>> {
    const results = await Promise.all(
        serviceIds.map(async (id) => {
            try {
                const res = await api.services[":id"]["pay-rules"].$get({ param: { id } });
                if (!res.ok) return [id, [] as PayRule[]] as const;
                const body = (await res.json()) as { data?: PayRule[] };
                return [id, body.data ?? []] as const;
            } catch {
                // A pay-rule read failing must not take down the services page.
                return [id, [] as PayRule[]] as const;
            }
        }),
    );
    return Object.fromEntries(results);
}

/** The rate half of the body, keyed by type so the wrong unit name cannot be sent. */
function rateBody(type: string, rate: number, deduction: number | null) {
    if (type === "fixed") return { type: "fixed" as const, amountCents: rate };
    if (type === "percent_after_deduction") {
        return { type: "percent_after_deduction" as const, percentBps: rate, deductionCents: deduction ?? 0 };
    }
    return { type: "percent" as const, percentBps: rate };
}

// Takes the narrow shape it uses, not `Response`: hono/client hands back a
// typed `ClientResponse<…, 409, "json">` whose body type differs per status,
// and widening it to `Response` at the call site would throw away exactly the
// typing that makes the client worth having.
async function failureMessage(res: { json(): Promise<unknown> }, fallback: string): Promise<string> {
    // The API's 409 for a duplicate rule is written for this screen; showing it
    // verbatim is better than a generic "could not save", which is what sent
    // people to add the same rule a second time.
    const body = await res.json().catch(() => ({}));
    const err = (body as { error?: { message?: string }; message?: string });
    return err.error?.message ?? err.message ?? fallback;
}

/**
 * `pay-rule-save` is create OR update, decided by whether the form carries a
 * ruleId. One intent because it is one thing a person did, and because a split
 * pair drifts — the create path gains a field the edit path never learns about.
 */
export async function savePayRule(api: Api, form: FormData): Promise<PayRuleActionResult> {
    const serviceId = String(form.get("serviceId") ?? "");
    const ruleId = String(form.get("ruleId") ?? "");
    const userId = String(form.get("userId") ?? "");
    const type = String(form.get("type") ?? "percent");
    const rate = Number(form.get("rate"));
    const rawDeduction = String(form.get("deduction") ?? "");
    const deduction = rawDeduction === "" ? null : Number(rawDeduction);

    if (!serviceId || !Number.isInteger(rate) || rate <= 0) {
        return { ok: false, intent: "pay-rule-save", serviceId, message: m.settings_pay_rule_error_rate() };
    }

    const rateFields = rateBody(type, rate, deduction);
    const res = ruleId
        ? await api.services[":id"]["pay-rules"][":ruleId"].$put({
            param: { id: serviceId, ruleId },
            json: rateFields,
        })
        : await api.services[":id"]["pay-rules"].$post({
            param: { id: serviceId },
            // Absent means the SERVICE DEFAULT. An empty string is not a user id
            // and would be refused as an ineligible member.
            json: { ...rateFields, ...(userId ? { userId } : {}) },
        });

    if (!res.ok) {
        return {
            ok: false, intent: "pay-rule-save", serviceId,
            message: await failureMessage(res, m.settings_pay_rule_error_save()),
        };
    }
    return { ok: true, intent: "pay-rule-save", serviceId };
}

export async function deletePayRule(api: Api, form: FormData): Promise<PayRuleActionResult> {
    const serviceId = String(form.get("serviceId") ?? "");
    const ruleId = String(form.get("ruleId") ?? "");
    const res = await api.services[":id"]["pay-rules"][":ruleId"].$delete({
        param: { id: serviceId, ruleId },
    });
    if (!res.ok) {
        return {
            ok: false, intent: "pay-rule-delete", serviceId,
            message: await failureMessage(res, m.settings_pay_rule_error_remove()),
        };
    }
    return { ok: true, intent: "pay-rule-delete", serviceId };
}
