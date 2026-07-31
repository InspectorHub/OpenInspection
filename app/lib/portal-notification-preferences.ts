import { createApi } from "~/lib/api-client.server";
import { m } from "~/paraglide/messages";
import type { LoadContext } from "~/lib/load-context";
import type { AlwaysSentItem, ChoiceRow } from "~/components/notifications/NotificationPreferences";

/**
 * The client Hub's notification-settings seam (spec §4.1) — its own module
 * rather than another entry in `section-loaders.ts`, because it is the one
 * "section" that is not about the inspection. It is reached from the bell, it
 * covers everything the company sends this person, and the inspection in the
 * URL is only where they happened to be standing.
 */
export interface NotificationsLoaderResult {
    alwaysSent: AlwaysSentItem[];
    youChoose: ChoiceRow[];
    error: string | null;
}

/**
 * The client's own notification settings for THIS company.
 *
 * Same portal-session cookie as the Notices reads, and for the same reason:
 * this is the only thing that identifies the reader. Unlike the other sections
 * it is not about the inspection at all — it is reached from the bell, and the
 * inspection in the URL is only where the reader happened to be standing.
 */
export async function loadNotificationsSection(
    context: LoadContext,
    tenant: string,
    cookieForApi: string,
): Promise<NotificationsLoaderResult> {
    try {
        const api = createApi(context);
        const res = await api.portalNotificationPrefs[":tenant"]["notification-preferences"].$get(
            { param: { tenant } },
            { headers: { Cookie: cookieForApi } },
        );
        if (!res.ok) {
            return { alwaysSent: [], youChoose: [], error: m.helper_section_service_unavailable() };
        }
        const body = (await res.json()) as { data?: { alwaysSent: AlwaysSentItem[]; youChoose: ChoiceRow[] } };
        const d = body.data ?? { alwaysSent: [], youChoose: [] };
        return { alwaysSent: d.alwaysSent, youChoose: d.youChoose, error: null };
    } catch {
        return { alwaysSent: [], youChoose: [], error: m.helper_section_service_unavailable() };
    }
}

/**
 * One explicit choice, from the Hub's own action.
 *
 * The portal-session cookie travels explicitly because the typed client does
 * not forward the browser's — the same reason the Notices writes pass it.
 */
export async function savePortalNotificationChoice(
    context: LoadContext,
    tenant: string,
    cookie: string,
    formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
    const api = createApi(context);
    const res = await api.portalNotificationPrefs[":tenant"]["notification-preferences"].$put(
        {
            param: { tenant },
            json: {
                classId: String(formData.get("classId") ?? ""),
                channel: String(formData.get("channel") ?? "email") as "email" | "sms" | "in_app",
                enabled: formData.get("enabled") === "true",
            },
        },
        { headers: { Cookie: cookie } },
    );
    return res.ok ? { ok: true } : { ok: false, error: m.portal_notif_save_error() };
}
