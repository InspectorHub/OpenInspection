import type { AlwaysSentItem, ChoiceRow } from "~/components/notifications/NotificationPreferences";
import type { Api as CoreApi } from "~/lib/api-client.server";
import { m } from "~/paraglide/messages";

/**
 * The Settings → Profile page's seam onto the notification-preferences API.
 *
 * Extracted from the route because it is a self-contained unit — one read, one
 * write, and the failure policy that ties them together — and because the route
 * is already long enough that the file-size gate says so out loud.
 */

export interface NotificationScreen {
    alwaysSent: AlwaysSentItem[];
    youChoose: ChoiceRow[];
    /** Set when the read failed. NOT the same as "you have nothing". */
    error: string | null;
}

/**
 * A failed read is NOT an empty screen.
 *
 * Rendering `[]` on failure printed "0 notifications you cannot switch off"
 * above a paragraph explaining why we always send them — a confident,
 * false answer, and the count is the loudest thing on the card. Caught in
 * Chrome; every unit test called it green because they all stubbed a 200.
 */
const FAILED = (): NotificationScreen =>
    ({ alwaysSent: [], youChoose: [], error: m.settings_notifications_unavailable() });

/**
 * Only the one client this module touches. Typing it as `any` would be the
 * cheaper line and it is exactly what hid a missing client registration once
 * already: `api["notification-preferences"]` type-checked against nothing.
 */
type Api = { notificationPrefs: CoreApi["notificationPrefs"] };

/**
 * A failed read yields an EMPTY screen rather than throwing.
 *
 * The profile form and the notification card share a page but not a subject: a
 * notifications endpoint that 500s must not take the name, photo and signature
 * fields down with it. An empty card says "nothing to show", which is wrong but
 * recoverable on reload; a dead page is neither.
 */
export async function loadNotificationScreen(api: Api): Promise<NotificationScreen> {
    try {
        const res = await api.notificationPrefs["notification-preferences"].$get();
        if (!res.ok) return FAILED();
        const body = (await res.json()) as { data?: Omit<NotificationScreen, "error"> };
        return body.data ? { ...body.data, error: null } : FAILED();
    } catch {
        return FAILED();
    }
}

/**
 * One explicit choice, from the card's form data.
 *
 * The API refuses anything the send boundary would ignore — a class that is
 * always sent, a channel it never uses, a class this reader is not addressed
 * by — so a non-ok response here is a real answer and is surfaced, not
 * swallowed. A screen that accepts a change and then ignores it is worse than
 * one that says no.
 */
export async function saveNotificationChoice(
    api: Api,
    fd: FormData,
): Promise<{ success: boolean; error: string | null }> {
    const res = await api.notificationPrefs["notification-preferences"].$put({
        json: {
            classId: String(fd.get("classId") ?? ""),
            channel: String(fd.get("channel") ?? "email") as "email" | "sms" | "in_app",
            enabled: fd.get("enabled") === "true",
        },
    });
    return res.ok
        ? { success: true, error: null }
        : { success: false, error: m.settings_notifications_error() };
}

/**
 * A whole row, column or the entire grid.
 *
 * Separate from `saveNotificationChoice` because it is a different request, not
 * a loop over the single-cell one: N round trips would leave the screen half
 * changed if any of them failed, and the reader would have no way to tell which.
 */
export async function bulkNotificationChoice(
    api: Api,
    fd: FormData,
): Promise<{ success: boolean; error: string | null }> {
    const channel = String(fd.get("channel") ?? "");
    const classId = String(fd.get("classId") ?? "");
    const res = await api.notificationPrefs["notification-preferences"].bulk.$put({
        json: {
            action: String(fd.get("action") ?? "enable") as "enable" | "disable" | "reset",
            ...(channel ? { channel: channel as "email" | "sms" | "in_app" } : {}),
            ...(classId ? { classId } : {}),
        },
    });
    return res.ok
        ? { success: true, error: null }
        : { success: false, error: m.settings_notifications_error() };
}
