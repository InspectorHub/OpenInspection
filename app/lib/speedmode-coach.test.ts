import { describe, it, expect, beforeEach } from 'vitest';
import {
    SPEEDMODE_COACH_KEY,
    shouldShowSpeedModeCoach,
    markSpeedModeCoached,
} from '~/lib/speedmode-coach';

// Track H (IA-17) — device-level one-time coach mark flag.
describe('speedmode-coach', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('shows on a fresh device (no flag)', () => {
        expect(shouldShowSpeedModeCoach()).toBe(true);
    });

    it('markSpeedModeCoached stamps the flag and suppresses future shows', () => {
        markSpeedModeCoached();
        expect(localStorage.getItem(SPEEDMODE_COACH_KEY)).toBe('1');
        expect(shouldShowSpeedModeCoach()).toBe(false);
    });

    it('any pre-existing value suppresses the coach (not just "1")', () => {
        localStorage.setItem(SPEEDMODE_COACH_KEY, 'legacy');
        expect(shouldShowSpeedModeCoach()).toBe(false);
    });

    it('marking twice is idempotent', () => {
        markSpeedModeCoached();
        markSpeedModeCoached();
        expect(shouldShowSpeedModeCoach()).toBe(false);
    });
});
