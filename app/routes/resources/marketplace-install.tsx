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
    // RELAY the server's own sentence when it wrote one.
    //
    // The refusal a self-hosted operator hits most is a statutory package whose
    // authority PDF is not in storage yet, and that message is the whole remedy:
    // it names the revision, the endpoint to upload to, the sha256 it is checked
    // against, and where the authority publishes the file. Replacing it with
    // "Couldn't install this template. Please try again." threw all of that away
    // and, worse, gave advice that is false — retrying installs nothing, ever,
    // until somebody uploads a file they were never told about.
    //
    // A refusal that carries no message of its own (a gateway error, an
    // unparseable body) leaves this undefined, and the page falls back to its
    // own localised sentence.
    const detail = await res.json()
      .then((b) => (b as { error?: { message?: string } })?.error?.message)
      .catch(() => undefined);
    // No hardcoded fallback sentence here on purpose: when the server said
    // nothing, the PAGE's own localised message is what a reader should see,
    // and duplicating an English one in this file would put a second, untracked
    // copy of that copy outside the message catalogue.
    return { ok: false as const, error: detail };
  }
  const body = (await res.json()) as { data?: { localTemplateId?: string } };
  return { ok: true as const, localTemplateId: body.data?.localTemplateId ?? null };
}
