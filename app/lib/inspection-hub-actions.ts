/* ------------------------------------------------------------------ */
/*  Inspection-hub action helpers (pure — no React)                   */
/* ------------------------------------------------------------------ */

/**
 * Map an API `Response` to the inspection-hub action's standard result shape,
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
    const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    return {
      ok: false,
      intent,
      error: err?.error?.message ?? fallbackError,
    };
  }
  return { ok: true, intent, error: undefined };
}
