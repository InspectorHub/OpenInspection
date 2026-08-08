/**
 * BFF resource route for the report page's Art. 21 control (OI #271).
 *
 * DELIBERATELY UNAUTHENTICATED HERE, and that is not a gap. Every other
 * `resources/*` route relays a staff JWT; this one serves the report
 * RECIPIENT, who by design has no account — they hold a `?token=` link or a
 * `__Host-portal_session` cookie, and the API route
 * (`server/api/public/view-tracking.ts`) is what authenticates them, over
 * either path. A `getToken` gate here would make the right reachable only by
 * the inspector, which is nobody's right at all.
 *
 * It exists so the browser never calls `/api` directly: the report page is one
 * of the few public surfaces with a write, and the token-relay BFF stays the
 * single authenticated path (see CLAUDE.md, "Core BFF no client fetch").
 *
 * The control is mounted from `<ReportViewDisclosure>`, which is rendered by
 * `<ReportView>` — and that component has TWO route homes. Posting to a named
 * resource route rather than to "the current route" is what makes the control
 * behave identically on the standalone report page and inside the Hub.
 */
import type { Route } from "./+types/view-tracking";
import { writeViewTrackingObjected } from "~/lib/view-tracking.server";

export interface ViewTrackingActionResult {
    ok: boolean;
    objected: boolean;
}

export async function action({ request, context }: Route.ActionArgs): Promise<ViewTrackingActionResult> {
    const form = await request.formData();
    const inspectionId = String(form.get("inspectionId") ?? "");
    // The form carries the intent as two distinct values rather than a toggle:
    // a retried submit must not flip the state back, and "objected=true" twice
    // keeps the ORIGINAL date (the API guarantees that half).
    const objected = String(form.get("objected") ?? "") === "true";
    const token = String(form.get("token") ?? "");
    if (!inspectionId) return { ok: false, objected: !objected };
    return writeViewTrackingObjected(
        context,
        {
            inspectionId,
            ...(token ? { token } : {}),
            ...(request.headers.get("cookie") ? { cookie: request.headers.get("cookie") as string } : {}),
        },
        objected,
    );
}
