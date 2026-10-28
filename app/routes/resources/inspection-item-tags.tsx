/**
 * BFF resource route for the editor's item tags (`FieldDataSource.resources.itemTags`).
 *
 * loader: GET  ?inspectionId= -> { tags: Record<itemId, { id, name, color? }[]> } | { tags: null } when unreadable
 * action: POST intent=add|remove, inspectionId, itemId, tagId -> { success }
 *
 * The tag endpoints already existed (`/api/inspections/:id/tags`, `/items/:itemId/tags[/:tagId]`); the editor
 * never called them, so the chips on an item were gone after a reload. This is only the relay: the company's
 * tags, the role check and the tenant scoping all stay in the API.
 */
import type { Route } from "./+types/inspection-item-tags";
import { getToken, requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";

type TagRow = { id: string; name: string; color?: string | null };

type Relay = { headers: Record<string, string> };

/**
 * The tag routes are mounted on `/api/inspections` but are not part of the typed client's chain, so the three calls
 * are declared here with the shape they have (see `inspector-portal.tsx` for the same step on `complete`).
 */
interface TagApi {
  tags: { $get(args: { param: { id: string } }, opts: Relay): Promise<Response> };
  items: {
    ":itemId": {
      tags: {
        $post(args: { param: { id: string; itemId: string }; json: { tagId: string } }, opts: Relay): Promise<Response>;
        ":tagId": { $delete(args: { param: { id: string; itemId: string; tagId: string } }, opts: Relay): Promise<Response> };
      };
    };
  };
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await getToken(context, request);
  if (!token) return { tags: null };

  const inspectionId = new URL(request.url).searchParams.get("inspectionId") ?? "";
  if (!inspectionId) return { tags: null };

  const api = createApi(context, { token });
  try {
    const res = await (api.inspections[":id"] as unknown as TagApi).tags.$get(
      { param: { id: inspectionId } },
      { headers: { "x-token-relay": "1" } },
    );
    if (!res.ok) return { tags: null };
    const body = (await res.json()) as { data?: Record<string, TagRow[]> };
    const tags: Record<string, Array<{ id: string; name: string; color?: string }>> = {};
    for (const [itemId, rows] of Object.entries(body.data ?? {})) {
      tags[itemId] = rows.map((r) => ({ id: r.id, name: r.name, ...(r.color ? { color: r.color } : {}) }));
    }
    return { tags };
  } catch {
    return { tags: null };
  }
}

export async function action({ request, context }: Route.ActionArgs) {
  const token = await requireToken(context, request);
  const api = createApi(context, { token });
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "");
  const inspectionId = String(fd.get("inspectionId") ?? "");
  const itemId = String(fd.get("itemId") ?? "");
  const tagId = String(fd.get("tagId") ?? "");
  if (!inspectionId || !itemId || !tagId) return { success: false as const, error: "Missing id" };

  const hdr = { headers: { "x-token-relay": "1" } } as const;
  try {
    if (intent === "add") {
      const res = await (api.inspections[":id"] as unknown as TagApi).items[":itemId"].tags.$post(
        { param: { id: inspectionId, itemId }, json: { tagId } },
        hdr,
      );
      return { success: res.ok };
    }
    if (intent === "remove") {
      const res = await (api.inspections[":id"] as unknown as TagApi).items[":itemId"].tags[":tagId"].$delete(
        { param: { id: inspectionId, itemId, tagId } },
        hdr,
      );
      return { success: res.ok };
    }
    return { success: false as const, error: "Unknown intent" };
  } catch (e) {
    return { success: false as const, error: e instanceof Error ? e.message : "Failed" };
  }
}
