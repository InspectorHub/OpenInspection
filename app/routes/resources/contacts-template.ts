/**
 * BFF resource route — the starter contacts spreadsheet, as a download.
 *
 * ── Why this is not `/api/imports/contacts-template.csv` ────────────────────
 * Two reasons, and the second is the load-bearing one.
 *
 * The template holds no workspace data. It is the same bytes for every
 * deployment and every person, derived from the importer's own header
 * vocabulary — so an API endpoint would be a network shape wrapped around a
 * constant, and a relay in front of it would be a second one.
 *
 * And a plain `<a href="/api/…">` does not work in local development anyway:
 * over `http://localhost` Chromium drops the `__Host-inspector_token` Secure
 * cookie, so a direct browser GET to an `/api/*` route 401s in dev while
 * authenticating fine in production HTTPS. `resources/cost-export.tsx` carries
 * the same note for the same reason. Reaching the file through a React Router
 * route — which the browser reaches with the plain `__session` cookie — is what
 * makes the link behave identically in both.
 *
 * ── Why it asks for a session at all ───────────────────────────────────────
 * Not because the file is sensitive; it is not. Because every other route under
 * `resources/` is gated, and the one deliberate exception says so in its own
 * header. An ungated route here would read as an oversight rather than as a
 * decision, and the gate costs one line.
 *
 * loader: GET -> text/csv, as an attachment.
 */
import type { Route } from "./+types/contacts-template";
import { getToken } from "~/lib/session.server";
import {
    CONTACTS_TEMPLATE_FILE_NAME,
    buildContactsTemplateCsv,
} from "../../../server/lib/migration-intake/contacts-template";

export async function loader({ request, context }: Route.LoaderArgs) {
    const token = await getToken(context, request);
    if (!token) return new Response("Unauthorized", { status: 401 });

    // Built per request rather than cached in a module constant: the columns
    // are derived from the header vocabulary, and a value computed once at
    // module load would be the one thing in this feature that could go stale.
    return new Response(buildContactsTemplateCsv(), {
        headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${CONTACTS_TEMPLATE_FILE_NAME}"`,
        },
    });
}
