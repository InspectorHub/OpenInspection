import { qboApiFetch, type QboCaller } from "~/lib/qbo-api.server";
import type { LoadContext } from "~/lib/load-context";
import { m } from "~/paraglide/messages";

/** What the Sync now action hands back to the page. */
export type QboSyncActionResult =
  | { success: true; intent: "qbo-sync"; error: null; syncEnabled: undefined; sync: { processed: number; checkedAt: number } }
  | { success: false; intent: "qbo-sync"; error: string; syncEnabled: undefined };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/**
 * Runs the QuickBooks check and passes its result through. The API now answers
 * only after the scan has finished and written the time it last looked, so the
 * loader revalidation that follows reads the new time. A failure comes back as
 * one short sentence: the API's body is read for its reason code and nothing of
 * it is shown.
 */
export async function runQboSync(context: LoadContext, caller: QboCaller): Promise<QboSyncActionResult> {
  const fail = (error: string): QboSyncActionResult => ({ success: false, intent: "qbo-sync", error, syncEnabled: undefined });
  const res = await qboApiFetch(context, caller, "/sync", "POST");
  if (!res) return fail(m.settings_qbo_action_failed_sync());

  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = isRecord(body) && isRecord(body.error) ? body.error : null;
    const details = isRecord(error?.details) ? error.details : null;
    return fail(details?.reason === "qbo_sync_paused" ? m.settings_qbo_sync_paused() : m.settings_qbo_action_failed_sync());
  }

  const data = isRecord(body) && isRecord(body.data) ? body.data : null;
  if (!data || typeof data.processed !== "number" || typeof data.checkedAt !== "number") {
    return fail(m.settings_qbo_action_failed_sync());
  }
  return {
    success: true, intent: "qbo-sync", error: null, syncEnabled: undefined,
    sync: { processed: data.processed, checkedAt: data.checkedAt },
  };
}
