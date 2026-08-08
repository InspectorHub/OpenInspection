/**
 * BFF access to the recipient's GDPR Art. 21 objection to report-view
 * measurement (OI #271, LIA condition 9).
 *
 * Two callers, one helper, because the report page has two homes: the
 * standalone `/report-view/:tenant/:id` route and the inline mount inside the
 * client-portal Hub. A right that is reachable on one of them and not the other
 * is the exact failure the LIA's condition 9 calls out — so the read lives here
 * rather than being written twice and drifting once.
 *
 * BOTH portal entry paths are relayed. `?token=` is the emailed report link,
 * `__Host-portal_session` is the signed-in hub; `resolvePortalRecipient` on the
 * API side accepts either, and the typed client's fetch does not carry cookies
 * on its own, so the cookie header is forwarded explicitly (the same shape
 * `portal-notifications.tsx` uses).
 *
 * Never throws and never surfaces an error: a failed read means the disclosure
 * renders its default "you can turn this off" state, which is truthful for
 * every recipient who has not objected and harmless for one who has — the
 * control is idempotent, and the counter itself is gated on the stored marker,
 * not on what this page believes.
 */
import { createApi } from "~/lib/api-client.server";
import type { LoadContext } from "~/lib/load-context";

export interface ViewTrackingGrant {
    inspectionId: string;
    /** The emailed report link's `?token=`, when the reader arrived by one. */
    token?: string | undefined;
    /** Raw `Cookie` header, so a hub session reaches the same right. */
    cookie?: string | undefined;
}

/** Has this recipient objected to being counted? False whenever unknown. */
export async function readViewTrackingObjected(
    context: LoadContext,
    grant: ViewTrackingGrant,
): Promise<boolean> {
    try {
        const res = await createApi(context).publicReport.inspections[":id"]["view-tracking"].$get(
            { param: { id: grant.inspectionId }, query: grant.token ? { token: grant.token } : {} },
            grant.cookie ? { headers: { Cookie: grant.cookie } } : undefined,
        );
        // 401 = no live grant for this reader (an owner preview, a render token,
        // a stranger). Not an error, and not an objection.
        if (!res.ok) return false;
        const body = (await res.json()) as { data?: { objected?: boolean } };
        return body.data?.objected === true;
    } catch {
        return false;
    }
}

/** Record or withdraw the objection. Returns the stored state. */
export async function writeViewTrackingObjected(
    context: LoadContext,
    grant: ViewTrackingGrant,
    objected: boolean,
): Promise<{ ok: boolean; objected: boolean }> {
    try {
        const res = await createApi(context).publicReport.inspections[":id"]["view-tracking-objection"].$post(
            {
                param: { id: grant.inspectionId },
                query: grant.token ? { token: grant.token } : {},
                json: { objected },
            },
            grant.cookie ? { headers: { Cookie: grant.cookie } } : undefined,
        );
        if (!res.ok) return { ok: false, objected: !objected };
        const body = (await res.json()) as { data?: { objected?: boolean } };
        return { ok: true, objected: body.data?.objected === true };
    } catch {
        return { ok: false, objected: !objected };
    }
}
