import type { NotifyOptions } from "@core/field-ui/data-source";
import { pushToast } from "~/hooks/useToast";

/** The slice of `pushToast` this module uses; injectable so tests need no toast host. */
export type PushToast = (t: { message: string; variant?: "neutral" | "error" | "success" | "warning"; durationMs: number }) => void;

/**
 * Online state. On the server report online so SSR renders the live UI. Note that
 * `navigator` is NOT absent there: Node 21+ and workerd both define it, without `onLine`,
 * so the check is on the property being a boolean, not on `navigator` existing.
 */
export function webIsOnline(): boolean {
    if (typeof navigator === "undefined" || typeof navigator.onLine !== "boolean") return true;
    return navigator.onLine;
}

/** Subscribe to the browser's online/offline events. Returns the unsubscribe; a no-op on the server. */
export function webOnOnlineChange(cb: (online: boolean) => void): () => void {
    if (typeof window === "undefined") return () => undefined;
    const onOnline = () => cb(true);
    const onOffline = () => cb(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
        window.removeEventListener("online", onOnline);
        window.removeEventListener("offline", onOffline);
    };
}

/**
 * Default toast durations, taken from what `app/routes/inspection-edit.tsx` uses today
 * (grep of `pushToast` + `durationMs`): success 2000 ("photos added"),
 * error 8000 ("save failed", "photo upload failed", "partial upload"), and neutral 2500
 * ("entered next section"; the other neutral toast is the 6000 undo toast, which carries an action
 * and is not a `notify`).
 */
const DURATION_MS = { info: 2500, success: 2000, error: 8000 } as const;
const VARIANT = { info: "neutral", success: "success", error: "error" } as const;

export function webNotify(
    message: string,
    variant: "info" | "success" | "error" = "info",
    push: PushToast = pushToast,
    opts?: NotifyOptions,
): void {
    push({ message, variant: VARIANT[variant], durationMs: opts?.durationMs ?? DURATION_MS[variant] });
}
