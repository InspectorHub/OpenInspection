/* ------------------------------------------------------------------ */
/*  The standard answer shape of a write action (pure — no React)      */
/* ------------------------------------------------------------------ */

import { m } from "~/paraglide/messages";

/**
 * Map an API `Response` to the inspector-portal action's standard result shape,
 * parameterized by the intent literal. On a non-OK response it surfaces the
 * API's `error.message` (B-4: never unconditional ok:true), falling back to the
 * caller-supplied default. On success it returns `{ ok: true, intent }`.
 *
 * Behavior-preserving extraction of the repeated post→error-shape pattern in the
 * route's `action()` (send-agreement / request-payment / attest-sms / publish /
 * submit / return / unpublish). The create-reinspection branch carries an extra
 * `newId` field + pre-validation and stays inline.
 */
export async function toActionResult<I extends string>(
  res: { ok: boolean; json: () => Promise<unknown> },
  intent: I,
  fallbackError: string,
): Promise<{ ok: boolean; intent: I; error: string | undefined }> {
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as ServerErrorBody | null;
    return {
      ok: false,
      intent,
      error: knownServerErrorText(err) ?? err?.error?.message ?? fallbackError,
    };
  }
  return { ok: true, intent, error: undefined };
}

interface ServerErrorBody {
  error?: { message?: string; code?: string; details?: { metric?: unknown; used?: unknown; cap?: unknown } };
}

/**
 * The sentence for a server error code the UI knows, in the viewer's language; null for any other
 * code. The server's own wording for these is English and carries numbers and advice that belong to
 * the page, so a known code is never shown as the server wrote it. Add a code here, with its two
 * catalogue entries, rather than surfacing its message.
 *
 * QUOTA_EXHAUSTED is mapped for the two metrics the send paths report, email and sms: an allowance for
 * that kind of message is spent, or there is none of that kind at all (reported with a cap of 0). It is
 * NOT mapped for any other metric: creating an inspection at its cap, for one, keeps the server's own
 * message, which names the metric and the counts, and every caller of this helper sees that unchanged.
 * Counts are shown only when the server sent them.
 */
function knownServerErrorText(body: ServerErrorBody | null): string | null {
  const error = body?.error;
  if (error?.code === "QUOTA_EXHAUSTED") {
    const { metric, used, cap } = error.details ?? {};
    if (metric !== "email" && metric !== "sms") return null;
    const counts = typeof used === "number" && typeof cap === "number" ? { used, cap } : null;
    if (metric === "sms") {
      if (cap === 0) return m.inspections_hub_error_plan_sms_not_included();
      return counts ? m.inspections_hub_error_plan_sms_limit(counts) : m.inspections_hub_error_plan_limit();
    }
    // A cap of 0 on email is the sending service's own quota running out, which carries no count of ours.
    if (metric === "email" && cap === 0) return m.inspections_hub_error_email_quota_exhausted();
    if (metric === "email" && counts) return m.inspections_hub_error_plan_email_limit(counts);
    return m.inspections_hub_error_plan_limit();
  }
  return null;
}
