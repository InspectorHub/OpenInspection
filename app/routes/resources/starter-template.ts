/**
 * BFF resource route — the starter CONTACTS spreadsheet, as a download.
 *
 * ── Why this is not `/api/imports/contacts-template.csv` ────────────────────
 * Two reasons, and the second is the load-bearing one.
 *
 * The template holds no workspace data. It is the same bytes for every
 * deployment and every person, derived from the interchange vocabulary — so an
 * API endpoint would be a network shape wrapped around a constant, and a relay
 * in front of it would be a second one.
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
 * The members template is its own route beside this one rather than a query
 * parameter here: two entry points read different columns, and a file that
 * changes shape with a parameter is a file whose name no longer says what it
 * teaches.
 *
 * loader: GET -> text/csv, as an attachment.
 */
import type { Route } from "./+types/starter-template";
import { getToken } from "~/lib/session.server";
import {
    CONTACTS_TEMPLATE_FILE_NAME,
    buildTemplateCsv,
} from "../../../server/lib/migration-intake/starter-template";
import { CONTACT_EXCHANGE } from "../../../server/lib/data-exchange/contacts";

export async function loader({ request, context }: Route.LoaderArgs) {
    const token = await getToken(context, request);
    if (!token) return new Response("Unauthorized", { status: 401 });

    // Built per request rather than cached in a module constant: the columns
    // are derived from the vocabulary and from the live mapping decision, and a
    // value computed once at module load would be the one thing in this feature
    // that could go stale.
    return new Response(buildTemplateCsv(CONTACT_EXCHANGE), {
        headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${CONTACTS_TEMPLATE_FILE_NAME}"`,
        },
    });
}
