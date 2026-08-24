/**
 * BFF resource route — the starter TEAM-MEMBERS spreadsheet, as a download.
 *
 * A sibling of `starter-template.ts` rather than a parameter on it, and the
 * reasoning for the route shape, the session gate and the per-request build all
 * live in that file's header. What differs here is the only thing that should:
 * the manifest it is derived from. A members file teaches a different format
 * because a different entity declares it — which is exactly why a second
 * template is now possible at all.
 *
 * loader: GET -> text/csv, as an attachment.
 */
import type { Route } from "./+types/members-template";
import { getToken } from "~/lib/session.server";
import {
    MEMBERS_TEMPLATE_FILE_NAME,
    buildTemplateCsv,
} from "../../../server/lib/migration-intake/starter-template";
import { MEMBER_EXCHANGE } from "../../../server/lib/data-exchange/members";

export async function loader({ request, context }: Route.LoaderArgs) {
    const token = await getToken(context, request);
    if (!token) return new Response("Unauthorized", { status: 401 });

    return new Response(buildTemplateCsv(MEMBER_EXCHANGE), {
        headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${MEMBERS_TEMPLATE_FILE_NAME}"`,
        },
    });
}
