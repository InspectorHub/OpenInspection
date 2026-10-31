/**
 * BFF resource route for the offline media drain.
 *
 * A photo, a baked crop or a baked annotation that was captured offline is
 * uploaded when the connection returns. A browser request straight to
 * `/api/inspections/...` carries no session in hosted deployments, so the drain
 * posts here instead and this route forwards to the API with the session token.
 *
 * One endpoint, three kinds (`kind` discriminator):
 *  - `photo`    -> POST /api/inspections/:id/upload
 *  - `crop`     -> POST /api/inspections/:id/items/:itemId/photos/:photoIndex/crop
 *  - `annotate` -> POST /api/inspections/:id/items/:itemId/photos/:photoIndex/annotation
 *
 * The answer keeps the API's `{ data: { key | croppedKey | annotatedKey } }`
 * shape, which is what the web uploader reads. An upstream failure comes back
 * with the upstream status (and the API's stable error code, when it sent one). Nothing is
 * forwarded without a session or without the ids the endpoint addresses by.
 */
import type { Route } from "./+types/media-upload";
import { getToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { isPathSegment } from "~/lib/path-segment";

function fail(status: number, error: string, code?: string): Response {
    return Response.json(code ? { error, code } : { error }, { status });
}

function text(fd: FormData, name: string): string {
    const v = fd.get(name);
    return typeof v === "string" ? v.trim() : "";
}

export async function action({ request, context }: Route.ActionArgs): Promise<Response> {
    const token = await getToken(context, request);
    if (!token) return fail(401, "Unauthorized");

    const fd = await request.formData().catch(() => null);
    if (!fd) return fail(400, "Expected a multipart form");

    const kind = text(fd, "kind");
    const inspectionId = text(fd, "inspectionId");
    const itemId = text(fd, "itemId");
    if (kind !== "photo" && kind !== "crop" && kind !== "annotate") return fail(400, "Unknown kind");
    if (!inspectionId) return fail(400, "inspectionId is required");
    if (!itemId) return fail(400, "itemId is required");
    if (!isPathSegment(inspectionId)) return fail(400, "inspectionId is not a valid id");
    if (!isPathSegment(itemId)) return fail(400, "itemId is not a valid id");

    const api = createApi(context, { token });

    try {
        if (kind === "photo") {
            const file = fd.get("file");
            if (!(file instanceof File)) return fail(400, "file is required");
            const res = await api.inspections[":id"].upload.$post({
                param: { id: inspectionId },
                form: { file, itemId },
            });
            return await relay(res);
        }

        const image = fd.get("image");
        const photoIndexRaw = text(fd, "photoIndex");
        const photoIndex = Number(photoIndexRaw);
        const sectionId = text(fd, "sectionId");
        if (!(image instanceof File)) return fail(400, "image is required");
        if (photoIndexRaw === "" || !Number.isInteger(photoIndex) || photoIndex < 0) {
            return fail(400, "photoIndex must be a non-negative integer");
        }
        const param = { id: inspectionId, itemId, photoIndex: String(photoIndex) };

        if (kind === "crop") {
            const crop = text(fd, "crop");
            if (!crop) return fail(400, "crop is required");
            const res = await api.inspections[":id"].items[":itemId"].photos[":photoIndex"].crop.$post({
                param,
                form: sectionId ? { image, crop, sectionId } : { image, crop },
            });
            return await relay(res);
        }

        const nodes = fd.get("nodes");
        if (typeof nodes !== "string") return fail(400, "nodes is required");
        const res = await api.inspections[":id"].items[":itemId"].photos[":photoIndex"].annotation.$post({
            param,
            form: sectionId ? { image, nodes, sectionId } : { image, nodes },
        });
        return await relay(res);
    } catch {
        // A network failure is retryable and must read as one, not as a rejected upload.
        return fail(502, "Upload could not be forwarded");
    }
}

/** The stable machine-readable code of the API's error envelope (`{ error: { code } }`), when it has one. */
async function upstreamCode(res: { json: () => Promise<unknown> }): Promise<string | undefined> {
    const body = (await res.json().catch(() => null)) as { error?: { code?: unknown } } | null;
    const code = body?.error?.code;
    return typeof code === "string" && code !== "" ? code : undefined;
}

/**
 * Hand the API's answer back: its status, and its `data` object when it succeeded. A failure keeps the API's status and
 * its stable error code (never its message), so the browser can tell an unsupported file type from any other 400.
 */
async function relay(res: { ok: boolean; status: number; json: () => Promise<unknown> }): Promise<Response> {
    if (!res.ok) return fail(res.status, `Upstream answered ${res.status}`, await upstreamCode(res));
    const body = (await res.json().catch(() => null)) as { data?: unknown } | null;
    return Response.json({ data: body?.data ?? null }, { status: 200 });
}
