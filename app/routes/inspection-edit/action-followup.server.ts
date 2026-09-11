import type { createApi } from "~/lib/api-client.server";

/**
 * #119 — the editor's one write that only a RE-INSPECTION has: the follow-up
 * verdict on an item carried forward from the baseline.
 *
 * ── WHY IT IS AN INTENT AND NOT A COLLAB-API CALL ───────────────────────────
 * Every other finding field is written by the browser straight into the live
 * Y.Doc. This one cannot be, because the panel that collects it is rendered deep
 * inside the item editor and holds no doc handle — and threading one down to it
 * would put a second, parallel write path beside the rating buttons. So the
 * submission goes the way a form goes: fetcher → this action → the authorized
 * collab route → the Durable Object, which patches the SAME document and
 * broadcasts the change back to every connected editor. One document, one
 * authority, and the inspector sees their own answer arrive the way a
 * collaborator's would.
 *
 * ── ONE ENTRY POINT, `null` FOR "NOT MINE" ──────────────────────────────────
 * Same contract as `handleStatutoryIntent`: `null` means the caller carries on
 * down its chain, and is deliberately distinguishable from a handled write that
 * failed (`{ ok: false }`). Falling through on an intent this module owns would
 * reach the bottom of the action and answer `{ ok: true }` over a write that
 * never happened.
 */
type Api = ReturnType<typeof createApi>;

export type FollowupActionResult = {
  ok: boolean;
  intent: "set-followup";
  /** The server's sentence when it wrote one — a refused key names the set. */
  error?: string;
};

/**
 * The route validates the body by hand (`c.req.json()` + a Zod `safeParse`)
 * rather than through a route validator, so the generated client type carries no
 * `json` for it — the same situation as the calendar read-set PUT. The hono
 * client still sends the body at runtime; the cast describes that, and nothing
 * more.
 */
type FollowupPost = (args: {
  param: { id: string };
  json: { itemId: string; status: string | null; notes?: string };
}) => Promise<Response>;

/**
 * A keyed `Record` rather than a type literal naming the method, and that is not
 * a style choice: `lint:middleware-budget` counts in-process API fan-out by
 * grepping the source for dollar-prefixed verb names, so spelling one in a TYPE
 * as well as at the call site would report two calls where there is one — and a
 * budget that counts mentions instead of calls stops measuring the thing it is
 * for. The shape stays honest: the only key ever read is the one used below.
 */
type CollabEndpoints = Record<string, FollowupPost>;

export async function handleFollowupIntent(
  intent: string,
  formData: FormData,
  api: Api,
  id: string,
): Promise<FollowupActionResult | null> {
  if (intent !== "set-followup") return null;

  const itemId = String(formData.get("itemId") ?? "");
  // An empty select means "no conclusion recorded yet" — the state a carried
  // item starts in — so it travels as null rather than being dropped. Without
  // that, an inspector could set a verdict but never take one back.
  const rawStatus = String(formData.get("status") ?? "");
  const status = rawStatus.length > 0 ? rawStatus : null;
  // ABSENT means "leave the note alone". The panel only sends the field when the
  // note is what changed, so recording a status cannot erase a note.
  const hasNotes = formData.has("notes");
  const notes = hasNotes ? String(formData.get("notes") ?? "") : undefined;

  if (!itemId) return { ok: false, intent: "set-followup", error: "Missing item." };

  const followup = (api.inspections[":id"].collab as unknown as { followup: CollabEndpoints }).followup;
  const res = await followup.$post({
    param: { id },
    json: notes === undefined ? { itemId, status } : { itemId, status, notes },
  });
  if (res.ok) return { ok: true, intent: "set-followup" };

  // 501 is collab-off (no Durable Object binding). Say so, because the field is
  // genuinely unavailable in that deployment rather than momentarily failing —
  // a generic "try again" would be advice that cannot work.
  const body = (await res.json().catch(() => null)) as { error?: string; reason?: string } | null;
  const error =
    res.status === 501
      ? "Live editing is not enabled on this deployment, so the follow-up verdict cannot be saved."
      : body?.reason === "ambiguous"
        ? "This item appears in more than one unit of this round; the verdict was not recorded."
        : body?.error ?? "The follow-up verdict was not saved.";
  return { ok: false, intent: "set-followup", error };
}
