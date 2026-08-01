import { createApi } from "~/lib/api-client.server";
import { m } from "~/paraglide/messages";
import type { LoadContext } from "~/lib/load-context";
import type { AlwaysSentItem, ChoiceRow } from "~/components/notifications/NotificationPreferences";
import type { SmsConsent } from "~/components/notifications/SmsConsentBlock";

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
    /** Null when this reader has no SMS identity to consent with (§4.2). */
    smsConsent: SmsConsent | null;
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
            return { alwaysSent: [], youChoose: [], smsConsent: null, error: m.helper_section_service_unavailable() };
        }
        const body = (await res.json()) as {
            data?: { alwaysSent: AlwaysSentItem[]; youChoose: ChoiceRow[]; smsConsent: SmsConsent | null };
        };
        const d = body.data ?? { alwaysSent: [], youChoose: [], smsConsent: null };
        return { alwaysSent: d.alwaysSent, youChoose: d.youChoose, smsConsent: d.smsConsent ?? null, error: null };
    } catch {
        return { alwaysSent: [], youChoose: [], smsConsent: null, error: m.helper_section_service_unavailable() };
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

/** A whole row, column or the entire grid, in one request. */
export async function bulkPortalNotificationChoice(
    context: LoadContext,
    tenant: string,
    cookie: string,
    formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
    const api = createApi(context);
    const channel = String(formData.get("channel") ?? "");
    const classId = String(formData.get("classId") ?? "");
    const res = await api.portalNotificationPrefs[":tenant"]["notification-preferences"].bulk.$put(
        {
            param: { tenant },
            json: {
                action: String(formData.get("action") ?? "enable") as "enable" | "disable" | "reset",
                ...(channel ? { channel: channel as "email" | "sms" | "in_app" } : {}),
                ...(classId ? { classId } : {}),
            },
        },
        { headers: { Cookie: cookie } },
    );
    return res.ok ? { ok: true } : { ok: false, error: m.portal_notif_save_error() };
}

/** Cookie plus the two evidence headers, omitting any the request lacks. */
function forwardedEvidence(request: Request): Record<string, string> {
    const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for");
    const ua = request.headers.get("user-agent");
    return {
        Cookie: request.headers.get("cookie") ?? "",
        ...(ip ? { "cf-connecting-ip": ip } : {}),
        ...(ua ? { "user-agent": ua } : {}),
    };
}

/**
 * Record an inline SMS consent grant, carrying the version that was on screen.
 *
 * THE IP AND USER AGENT ARE FORWARDED EXPLICITLY, and they have to be. The BFF
 * calls the API in-process over the `API_WORKER` binding, so the browser's
 * `cf-connecting-ip` and `user-agent` never reach the handler on their own —
 * the ledger recorded nulls for both, which are the two fields that make a
 * consent row defensible in a carrier audit. Verified in the browser; nothing
 * in the type system or the tests would have said a word.
 */
export async function grantPortalSmsConsent(
    context: LoadContext,
    tenant: string,
    request: Request,
    formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
    const api = createApi(context);
    const res = await api.portalNotificationPrefs[":tenant"]["notification-preferences"]["sms-consent"].$put(
        {
            param: { tenant },
            json: { disclosureVersion: Number(formData.get("disclosureVersion") ?? 0) },
        },
        // Absent headers are OMITTED, not sent empty. An empty string would be
        // stored as one, and a consent row claiming "we recorded an ip and it
        // was blank" is worse evidence than one that plainly has none.
        { headers: forwardedEvidence(request) },
    );
    return res.ok ? { ok: true } : { ok: false, error: m.portal_notif_save_error() };
}
