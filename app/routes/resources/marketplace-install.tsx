/**
 * IA-39 — BFF resource route for installing a marketplace template.
 *
 * action: POST /api/templates/marketplace/:id/import via the token-relay API
 * client (never a raw client fetch — that would 401). Returns the new local
 * template id so the caller can jump to it in the library.
 */
import type { Route } from "./+types/marketplace-install";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";

export async function action({ request, context }: Route.ActionArgs) {
  const token = await requireToken(context, request);
  const form = await request.formData();
  const raw = form.get("templateId");
  const id = typeof raw === "string" ? raw : "";
  if (!id) return { ok: false as const, error: "Missing template id." };

  const api = createApi(context, { token });
  // `import` lives at /:id/import on the marketplace mount; it isn't on the
  // typed client surface, so reach it the same way the other action routes do.
  const marketplace = api.marketplace as unknown as {
    [":id"]: { import: { $post: (args: { param: { id: string } }) => Promise<Response> } };
  };
  const res = await marketplace[":id"].import.$post({ param: { id } });
  if (!res.ok) {
    return { ok: false as const, error: "Couldn't install this template. Please try again." };
  }
  const body = (await res.json()) as { data?: { localTemplateId?: string } };
  return { ok: true as const, localTemplateId: body.data?.localTemplateId ?? null };
}
