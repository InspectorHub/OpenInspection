/**
 * The single source for the options both Stripe pay surfaces mount <Elements>
 * with — the invoice/Hub panel (portal/sections/StripePayPanel) and the checkout
 * card (checkout/PayCard).
 *
 * They built these options inline and byte-identically, which is how both came to
 * be missing the same two things: no `locale`, so Stripe's own strings rendered
 * in the browser's language rather than the workspace's, and `theme: 'flat'`
 * unconditionally, so a light payment form sat inside a dark page. Elements
 * renders in an iframe — the app's CSS variables cannot cross into it, so the
 * colour and the language have to be passed in explicitly. Two call sites meant
 * fixing that twice and, in practice, never.
 */
import type { StripeElementsOptions, StripeElementLocale, Appearance } from '@stripe/stripe-js';

/**
 * The brand colour Elements falls back to when a tenant has set none. Elements
 * cannot read `--ih-primary` through the iframe boundary, so this is a literal on
 * purpose; it matches the platform default the DS token resolves to.
 */
export const DEFAULT_BRAND_COLOR = '#6366f1';

/** Every locale Stripe Elements accepts, minus 'auto'. */
const STRIPE_LOCALES = new Set<string>([
    'ar', 'bg', 'cs', 'da', 'de', 'el', 'en', 'en-AU', 'en-CA', 'en-NZ', 'en-GB',
    'es', 'es-ES', 'es-419', 'et', 'fi', 'fil', 'fr', 'fr-CA', 'fr-FR', 'he', 'hu',
    'hr', 'id', 'it', 'it-IT', 'ja', 'ko', 'lt', 'lv', 'ms', 'mt', 'nb', 'nl', 'no',
    'pl', 'pt', 'pt-BR', 'ro', 'ru', 'sk', 'sl', 'sv', 'th', 'tr', 'vi', 'zh',
]);

/** Canonical BCP-47 casing (`pt-br` → `pt-BR`) so a lookup can be exact. */
function canonicalise(tag: string): string {
    const [lang, region] = tag.split('-');
    if (!lang) return '';
    return region ? `${lang.toLowerCase()}-${region.toUpperCase()}` : lang.toLowerCase();
}

/**
 * Map an app display locale onto one Stripe accepts.
 *
 * Stripe takes a fixed union, and the app's locales do not all appear in it —
 * `useDisplayLocale()` defaults to `en-US`, which Stripe does not list even though
 * it lists en-AU/en-CA/en-GB/en-NZ. So an unlisted region tag falls back to its
 * base language, and anything Stripe would not recognise at all becomes 'auto',
 * which is its own browser detection: no worse than the behaviour this replaces.
 */
export function stripeElementLocale(displayLocale: string | null | undefined): StripeElementLocale {
    if (!displayLocale) return 'auto';
    const tag = canonicalise(displayLocale);
    if (STRIPE_LOCALES.has(tag)) return tag as StripeElementLocale;
    const base = tag.split('-')[0];
    if (base && STRIPE_LOCALES.has(base)) return base as StripeElementLocale;
    return 'auto';
}

/**
 * Pick the Stripe theme for the scheme the page is painted in.
 *
 * `field` is the high-contrast on-site scheme; it is darker than `dark`, so both
 * map to Stripe's night theme. Anything unrecognised stays light, which is what
 * the page defaults to before its scheme is known.
 */
export function stripeAppearanceTheme(colorScheme: string | null | undefined): 'flat' | 'night' {
    return colorScheme === 'dark' || colorScheme === 'field' ? 'night' : 'flat';
}

/**
 * The scheme the document is currently painted with, from the attribute root.tsx
 * renders server-side and useTheme keeps current.
 *
 * Read rather than subscribed: Elements mounts only after a click, so the
 * attribute is always set by then, and the alternative (calling useTheme here)
 * would register a second matchMedia listener and re-apply the scheme from inside
 * a payment component. The trade is that toggling the theme while a pay form is
 * open leaves that form in the theme it mounted with.
 */
export function currentColorScheme(): string {
    if (typeof document === 'undefined') return 'light';
    return document.documentElement.getAttribute('data-color-scheme') || 'light';
}

/** Build the <Elements> options for a client secret on the current page. */
export function buildStripeElementsOptions({
    clientSecret,
    brandColor,
    displayLocale,
    colorScheme,
}: {
    clientSecret: string;
    brandColor: string | null;
    displayLocale: string | null | undefined;
    colorScheme?: string | null;
}): StripeElementsOptions {
    const appearance: Appearance = {
        theme: stripeAppearanceTheme(colorScheme ?? currentColorScheme()),
        variables: {
            colorPrimary: brandColor ?? DEFAULT_BRAND_COLOR,
            fontFamily: 'inherit',
            borderRadius: '8px',
        },
    };
    return { clientSecret, locale: stripeElementLocale(displayLocale), appearance };
}
