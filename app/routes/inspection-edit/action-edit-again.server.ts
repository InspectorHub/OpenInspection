import type { createApi } from "~/lib/api-client.server";
import { refusalMessage } from "./action-errors.server";

type Api = ReturnType<typeof createApi>;

export type EditAgainActionResult =
  | { ok: true; intent: "edit-again" }
  | { ok: false; intent: "edit-again"; error: string };

/**
 * "Edit and republish": a published report becomes editable again WITHOUT being withdrawn (no link expires; clients keep
 * reading the last published version). The server answers 400 for a report that is not published and 403 without the
 * publish capability; its message goes back so the banner can show it.
 *
 * Same contract as `handleFollowupIntent`: `null` means "not mine", so the caller carries on down its chain.
 */
export async function handleEditAgainIntent(intent: string, api: Api, inspectionId: string): Promise<EditAgainActionResult | null> {
  if (intent !== "edit-again") return null;
  const res = await api.inspections[":id"]["edit-again"].$post({ param: { id: inspectionId }, json: {} });
  if (!res.ok) return { ok: false, intent, error: await refusalMessage(res, "Couldn't open the report for editing. Please try again.") };
  return { ok: true, intent };
}
