import { parseDepositPolicy } from "~/lib/deposit-policy-form";
import { parseCancellationPolicy } from "~/lib/cancellation-policy-form";
import { m } from "~/paraglide/messages";
import type { BookingActionResult } from "./booking-routing-actions";

/**
 * The `/settings/booking` policies that are written through `/api/admin/branding`
 * rather than through the tenant-config projection.
 *
 * Extracted for the same reason the routing intents were: the route file is at
 * the 400-line size gate. And these two belong together for a better reason than
 * that — the deposit default and the cancellation ladder are the only booking
 * policies stored on `tenant_configs` but reachable only through branding, so
 * both need the same JSON-in-a-form-field round trip and the same "an absent key
 * must not read as a clear" rule.
 *
 * ⚠️ THE ABSENT-KEY RULE IS LOAD-BEARING FOR BOTH. Neither `depositPolicy` nor
 * `cancellationPolicy` has a Zod `.default()`, precisely so a save that never
 * mentions one leaves it alone. Sending `null` is a real instruction — it CLEARS
 * the policy — so a helper that "helpfully" defaults a missing field to null
 * would silently switch off a configured deposit on every unrelated save.
 *
 * Returns `null` for an intent (or a form) it does not own, so the route keeps
 * its if-chain shape and ownership stays obvious at the call site.
 */

/** hono/client returns a ClientResponse, which is not assignable to Response. */
interface JsonReadable {
  ok: boolean;
  json: () => Promise<unknown>;
}

/** The subset of the typed client these two saves use. */
interface BrandingApi {
  adminBranding: {
    branding: {
      $post: (args: { json: Record<string, unknown> }) => Promise<JsonReadable>;
    };
  };
}

async function errorMessage(res: JsonReadable): Promise<string | undefined> {
  const err = await res.json().catch(() => null);
  return ((err as Record<string, Record<string, unknown>> | null)?.error?.message) as
    | string
    | undefined;
}

function post(api: unknown, json: Record<string, unknown>): Promise<JsonReadable> {
  return (api as BrandingApi).adminBranding.branding.$post({ json });
}

/**
 * The deposit half of `policies-save`.
 *
 * `null` means the form carried no `depositPolicy` at all — leave the stored one
 * alone. Anything else is an attempt, and a `message` on it means it failed.
 */
export async function saveDepositFromForm(
  api: unknown,
  form: FormData,
): Promise<{ ok: boolean; message?: string | undefined } | null> {
  if (!form.has("depositPolicy")) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(String(form.get("depositPolicy") ?? "null"));
  } catch {
    // Unparseable is not a clear-the-deposit instruction; it is a bad request.
    return { ok: false, message: m.settings_holiday_save_failed() };
  }

  const res = await post(api, { depositPolicy: parseDepositPolicy(raw) });
  return res.ok ? { ok: true } : { ok: false, message: await errorMessage(res) };
}

/**
 * The cancellation ladder, plus the agreement-clause attestation it depends on.
 *
 * ONE request, not two. `POST /api/admin/branding` applies
 * `attestCancellationClause` BEFORE the policy, so "confirm the clause and turn
 * fees on" is a single save that either wholly succeeds or wholly fails. Sending
 * them separately would produce the half-state the server's fee gate exists to
 * refuse — and would refuse it, confusingly, on the second of two saves the
 * person thought was one.
 *
 * ⚠️ `attestCancellationClause` is only forwarded when the form actually carried
 * it. It is transient rather than a column, and its `null` WITHDRAWS an
 * attestation — so defaulting it would revoke the confirmation on every save
 * that merely edited a fee.
 */
export async function handleCancellationPolicyIntent(
  api: unknown,
  form: FormData,
  intent: string,
): Promise<BookingActionResult | null> {
  if (intent !== "cancellation-policy-save") return null;

  let raw: unknown;
  try {
    raw = JSON.parse(String(form.get("cancellationPolicy") ?? "null"));
  } catch {
    return { ok: false, intent, message: m.settings_cancellation_save_failed() };
  }

  const json: Record<string, unknown> = {
    cancellationPolicy: parseCancellationPolicy(raw),
  };
  if (form.has("attestCancellationClause")) {
    json.attestCancellationClause = String(form.get("attestCancellationClause"));
  }

  const res = await post(api, json);
  // The server's own refusal — "confirm the clause before enabling fees" — comes
  // back here as a message. The panel checks the same rule first so a person sees
  // which control is at fault, but this path must still surface the sentence:
  // it is the only one that is true of an attestation invalidated between the
  // page load and the save.
  return res.ok ? { ok: true, intent } : { ok: false, intent, message: await errorMessage(res) };
}
