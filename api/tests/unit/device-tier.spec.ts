// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { detectTier, TIERS } from '../../public/js/device-tier.js';

describe('detectTier', () => {
    beforeEach(() => {
        vi.spyOn(window, 'matchMedia').mockReturnValue({
            matches: false, media: '', onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
        } as unknown as MediaQueryList);
    });

    it('returns tier E for Android Chrome non-PWA', async () => {
        Object.defineProperty(navigator, 'userAgent', {
            value: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120',
            configurable: true,
        });
        const tier = await detectTier();
        expect(tier.id).toBe('E');
        expect(tier.photoCap).toBe(Infinity);
    });

    it('returns tier D for iOS 14 Safari', async () => {
        Object.defineProperty(navigator, 'userAgent', {
            value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_2 like Mac OS X) AppleWebKit/605.1.15',
            configurable: true,
        });
        const tier = await detectTier();
        expect(tier.id).toBe('D');
        expect(tier.photoCap).toBe(30);
        expect(tier.quotaThreshold).toBe(0.4);
    });

    it('returns tier C for iOS 17 Safari (non-standalone)', async () => {
        Object.defineProperty(navigator, 'userAgent', {
            value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15',
            configurable: true,
        });
        const tier = await detectTier();
        expect(tier.id).toBe('C');
        expect(tier.photoCap).toBe(75);
    });

    it('TIERS export contains all 5 entries', () => {
        expect(Object.keys(TIERS).sort()).toEqual(['A', 'B', 'C', 'D', 'E']);
    });
});
