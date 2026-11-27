/**
 * localStorage key for the device-local opt-out of the upload preprocessing
 * pass (downscale + EXIF/GPS strip). Shared by the editor route, which reads it
 * at the photo entry points, and the header's More menu, whose toggle writes it.
 * One source of truth, so a choice made on any inspection (or none open) applies
 * to the next upload from this device.
 */
export const ORIGINAL_QUALITY_KEY = "oi.uploads.originalQuality";

/**
 * Device-local opt-out for the upload preprocessing pass. Default OFF means
 * preprocessing is ON (downscale + EXIF/GPS strip). Persisted to localStorage
 * so the choice survives reloads and is read at all three photo entry points
 * (item picker, burst commit, offline replay) from one source of truth.
 */
export function readOriginalQuality(): boolean {
    try {
        return typeof localStorage !== "undefined" && localStorage.getItem(ORIGINAL_QUALITY_KEY) === "1";
    } catch {
        return false;
    }
}

export function writeOriginalQuality(enabled: boolean): void {
    try {
        if (typeof localStorage === "undefined") return;
        if (enabled) localStorage.setItem(ORIGINAL_QUALITY_KEY, "1");
        else localStorage.removeItem(ORIGINAL_QUALITY_KEY);
    } catch {
        // A device that refuses storage keeps the default: preprocessing stays on.
    }
}
