import { useCallback, useRef } from 'react';

export interface PointerGestureHandlers {
    onSwipeLeft?:        () => void;
    onSwipeRight?:       () => void;
    onLongPress?:        () => void;
    swipeThresholdPx?:   number;
    swipeMaxDurationMs?: number;
    longPressMs?:        number;
}

/**
 * Returns event-handler props to spread onto a target element to detect
 * horizontal swipes (left / right) and long-presses via PointerEvents.
 *
 * Conventions:
 *   - Swipe left  (dx ≤ -threshold within maxDuration, |dy| ≤ threshold) → next item
 *   - Swipe right (dx ≥  threshold within maxDuration, |dy| ≤ threshold) → previous item
 *   - Long-press = pointer held within 10px of start for longPressMs
 *   - Vertical movement > threshold disqualifies as a swipe (avoid scroll hijack)
 */
export function usePointerGesture(h: PointerGestureHandlers) {
    const startRef       = useRef<{ x: number; y: number; t: number } | null>(null);
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const fired          = useRef(false);

    const threshold   = h.swipeThresholdPx   ?? 60;
    const maxDuration = h.swipeMaxDurationMs ?? 500;
    const longPressMs = h.longPressMs        ?? 500;

    const onPointerDown = useCallback((e: React.PointerEvent) => {
        startRef.current = { x: e.clientX, y: e.clientY, t: Date.now() };
        fired.current = false;
        if (h.onLongPress) {
            longPressTimer.current = setTimeout(() => {
                if (!fired.current) {
                    fired.current = true;
                    h.onLongPress?.();
                }
            }, longPressMs);
        }
    }, [h.onLongPress, longPressMs]);

    const cancel = useCallback(() => {
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
        startRef.current = null;
    }, []);

    const onPointerMove = useCallback((e: React.PointerEvent) => {
        if (!startRef.current || fired.current) return;
        const dx = e.clientX - startRef.current.x;
        const dy = e.clientY - startRef.current.y;
        if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
            if (longPressTimer.current) {
                clearTimeout(longPressTimer.current);
                longPressTimer.current = null;
            }
        }
    }, []);

    const onPointerUp = useCallback((e: React.PointerEvent) => {
        if (!startRef.current || fired.current) { cancel(); return; }
        const dx = e.clientX - startRef.current.x;
        const dy = e.clientY - startRef.current.y;
        const dt = Date.now() - startRef.current.t;
        cancel();
        if (Math.abs(dy) > threshold) return;
        if (dt > maxDuration) return;
        if (dx <= -threshold) h.onSwipeLeft?.();
        if (dx >=  threshold) h.onSwipeRight?.();
    }, [h.onSwipeLeft, h.onSwipeRight, threshold, maxDuration, cancel]);

    const onPointerCancel = cancel;

    return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel };
}
