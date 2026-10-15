import { z } from "zod";
import { relayedApiError } from "~/lib/relayed-api-error";
import type { createApi } from "~/lib/api-client.server";

const OpenInspectionsBody = z.object({
  error: z.object({
    code: z.literal("MEMBER_HAS_OPEN_INSPECTIONS"),
    details: z.object({ openInspections: z.number() }),
  }),
});

/**
 * The Team page's "remove-member" action. A removal the server refuses because
 * the member still has open inspections comes back as `openInspections`, so
 * the dialog can ask who takes them over instead of showing a bare failure.
 */
export async function removeMember(api: ReturnType<typeof createApi>, form: FormData) {
  const id = String(form.get("id") ?? "");
  const reassignTo = String(form.get("reassignTo") ?? "");
  const query = reassignTo ? { reassignTo } : form.get("unassign") === "true" ? { unassign: "true" as const } : {};
  const res = await api.team.members[":id"].$delete({ param: { id }, query });
  if (res.ok) return { ok: true as const };
  const parsed = OpenInspectionsBody.safeParse(await res.clone().json().catch(() => null));
  if (parsed.success) return { ok: false as const, error: await relayedApiError(res), openInspections: parsed.data.error.details.openInspections };
  return { ok: false as const, error: await relayedApiError(res) };
}
