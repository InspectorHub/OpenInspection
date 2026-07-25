/**
 * One source for the <Elements> options both pay surfaces mount with.
 *
 * They were built inline and byte-identically in two places
 * (app/components/checkout/PayCard.tsx and
 * app/components/portal/sections/StripePayPanel.tsx), and both got two things
 * wrong that only a shared builder can fix once:
 *
 *   - no `locale`, so Stripe's own copy ("Card number", "Your card's expiry date
 *     is in the past") rendered in the BROWSER's language while the page around
 *     it rendered in the app's. A client on a Spanish workspace saw a Spanish
 *     page with an English card form.
 *   - `theme: 'flat'` unconditionally, so a light payment form sat inside a dark
 *     page. Elements renders in an iframe, so the app's CSS variables cannot
 *     reach it — the theme has to be chosen explicitly from the scheme the page
 *     is actually painted in.
 *
 * The locale mapping is the part that needs pinning: Stripe accepts a fixed
 * union, and `useDisplayLocale()` returns values like `en-US` that are NOT in it.
 * Passing one through unmapped is an invalid option, so a region tag has to fall
 * back to its base language and an unknown tag to 'auto'.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
    stripeElementLocale,
    stripeAppearanceTheme,
    currentColorScheme,
    buildStripeElementsOptions,
    DEFAULT_BRAND_COLOR,
} from './stripe-elements-options';

describe('stripeElementLocale', () => {
    it('passes through a tag Stripe supports verbatim', () => {
        expect(stripeElementLocale('es-419')).toBe('es-419');
        expect(stripeElementLocale('en-GB')).toBe('en-GB');
        expect(stripeElementLocale('pt-BR')).toBe('pt-BR');
    });

    it('falls back to the base language for a region Stripe does not list', () => {
        // The app's own default. Stripe lists en-AU/en-CA/en-GB/en-NZ but not en-US.
        expect(stripeElementLocale('en-US')).toBe('en');
        expect(stripeElementLocale('es-MX')).toBe('es');
        expect(stripeElementLocale('zh-CN')).toBe('zh');
    });

    it("uses Stripe's own detection when the tag means nothing to it", () => {
        expect(stripeElementLocale('xx-YY')).toBe('auto');
        expect(stripeElementLocale('')).toBe('auto');
        expect(stripeElementLocale(undefined)).toBe('auto');
        expect(stripeElementLocale(null)).toBe('auto');
    });

    it('is case-insensitive about the region subtag', () => {
        expect(stripeElementLocale('EN-us')).toBe('en');
        expect(stripeElementLocale('PT-br')).toBe('pt-BR');
    });
});

describe('stripeAppearanceTheme', () => {
    it("uses Stripe's dark theme for both dark schemes", () => {
        expect(stripeAppearanceTheme('dark')).toBe('night');
        // 'field' is the high-contrast on-site scheme and is darker than 'dark';
        // a light form inside it is the exact mismatch this fixes.
        expect(stripeAppearanceTheme('field')).toBe('night');
    });

    it('uses the flat light theme otherwise, including when the scheme is unknown', () => {
        expect(stripeAppearanceTheme('light')).toBe('flat');
        expect(stripeAppearanceTheme(null)).toBe('flat');
        expect(stripeAppearanceTheme(undefined)).toBe('flat');
        expect(stripeAppearanceTheme('auto')).toBe('flat');
    });
});

describe('currentColorScheme', () => {
    afterEach(() => document.documentElement.removeAttribute('data-color-scheme'));

    it('reads the attribute the document is actually painted with', () => {
        document.documentElement.setAttribute('data-color-scheme', 'dark');
        expect(currentColorScheme()).toBe('dark');
    });

    it('reports light when nothing has set the attribute', () => {
        expect(currentColorScheme()).toBe('light');
    });
});

describe('buildStripeElementsOptions', () => {
    it('carries the clientSecret and the resolved brand colour', () => {
        const options = buildStripeElementsOptions({
            clientSecret: 'pi_123_secret_456',
            brandColor: '#ff5722',
            displayLocale: 'en-US',
            colorScheme: 'light',
        });
        expect(options.clientSecret).toBe('pi_123_secret_456');
        expect(options.appearance?.variables?.colorPrimary).toBe('#ff5722');
    });

    it('falls back to the platform brand colour when the tenant has none', () => {
        const options = buildStripeElementsOptions({
            clientSecret: 'cs',
            brandColor: null,
            displayLocale: 'en-US',
            colorScheme: 'light',
        });
        expect(options.appearance?.variables?.colorPrimary).toBe(DEFAULT_BRAND_COLOR);
    });

    it('sets the locale and theme that the two inline copies never did', () => {
        const dark = buildStripeElementsOptions({
            clientSecret: 'cs',
            brandColor: null,
            displayLocale: 'es-419',
            colorScheme: 'dark',
        });
        expect(dark.locale).toBe('es-419');
        expect(dark.appearance?.theme).toBe('night');

        const light = buildStripeElementsOptions({
            clientSecret: 'cs',
            brandColor: null,
            displayLocale: 'en-US',
            colorScheme: 'light',
        });
        expect(light.locale).toBe('en');
        expect(light.appearance?.theme).toBe('flat');
    });

    it('keeps the typography the surrounding page already set', () => {
        const options = buildStripeElementsOptions({
            clientSecret: 'cs',
            brandColor: null,
            displayLocale: 'en',
            colorScheme: 'light',
        });
        expect(options.appearance?.variables?.fontFamily).toBe('inherit');
        expect(options.appearance?.variables?.borderRadius).toBe('8px');
    });
});
