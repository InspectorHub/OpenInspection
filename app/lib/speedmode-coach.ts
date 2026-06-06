/**
 * Track H (IA-17) — one-time Speed Mode coach mark.
 *
 * Device-level flag (NOT user prefs — per decision 5 a per-device hint is
 * enough): first Speed Mode entry shows a translucent gesture explainer;
 * any tap/keypress dismisses it and stamps localStorage so it never
 * reappears on this device. try/catch guards SSR + privacy modes where
 * localStorage throws.
 */
export const SPEEDMODE_COACH_KEY = 'oi:speedmode-coached';

export function shouldShowSpeedModeCoach(): boolean {
    try {
        return localStorage.getItem(SPEEDMODE_COACH_KEY) === null;
    } catch {
        return false;
    }
}

export function markSpeedModeCoached(): void {
    try {
        localStorage.setItem(SPEEDMODE_COACH_KEY, '1');
    } catch {
        // noop — worst case the coach shows again next session
    }
}
