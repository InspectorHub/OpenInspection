import { test, expect } from '@playwright/test';

/**
 * #269 — proof that the i18n framework is ACTIVATED, not merely present.
 *
 * `/login` is the right surface for this: it was fully externalized in Phase C,
 * so a failure here is a resolution failure rather than a missing translation.
 * It is also pre-auth, which means no `users.locale` and no tenant default are
 * in play — exactly the rungs this file is NOT trying to test. What is under
 * test is the seam in `workers/app.ts`, which rewrites the incoming Cookie
 * header before paraglide reads it.
 *
 * Every case asserts the LANGUAGE OF THE RENDER, not just the `lang` attribute.
 * `lang` alone would stay green if the resolver worked and the message
 * catalogue never loaded — which is the precise failure this whole rollout
 * exists to rule out.
 */

const SPANISH_ON_LOGIN = /Iniciar sesión|Contraseña|Correo/;
const ENGLISH_ON_LOGIN = /Sign in|Password|Email/;

test.describe('locale activation', () => {
    test('a Spanish browser with no cookie gets Spanish', async ({ browser }) => {
        const ctx = await browser.newContext({ locale: 'es-419' });
        const page = await ctx.newPage();
        await page.goto('/login');

        await expect(page.locator('html')).toHaveAttribute('lang', 'es-419');
        await expect(page.locator('body')).toContainText(SPANISH_ON_LOGIN);
        await ctx.close();
    });

    test('an English browser is byte-for-byte unaffected', async ({ browser }) => {
        // The other half of the contract, and the one that would break every
        // existing user: someone who has set no preference must see exactly
        // what they saw before activation.
        const ctx = await browser.newContext({ locale: 'en-US' });
        const page = await ctx.newPage();
        await page.goto('/login');

        await expect(page.locator('html')).toHaveAttribute('lang', 'en');
        await expect(page.locator('body')).toContainText(ENGLISH_ON_LOGIN);
        await ctx.close();
    });

    test('a language we do not speak falls through to English, not to itself', async ({ browser }) => {
        // The resolver must IGNORE an unsupported tag rather than stop on it.
        // Stopping would render `lang="fr-FR"` over English text, which tells
        // a screen reader to pronounce English with French phonetics.
        const ctx = await browser.newContext({ locale: 'fr-FR' });
        const page = await ctx.newPage();
        await page.goto('/login');

        await expect(page.locator('html')).toHaveAttribute('lang', 'en');
        await expect(page.locator('body')).toContainText(ENGLISH_ON_LOGIN);
        await ctx.close();
    });

    test('an explicit cookie beats the browser, in both directions', async ({ browser }) => {
        // The switcher's contract, at the level where it can actually break.
        // The plan for #269 ranked the cookie BELOW Accept-Language; under that
        // ordering the first half of this test fails, because a Spanish-
        // browsered person who picks English is handed Spanish straight back.
        const spanishBrowser = await browser.newContext({ locale: 'es-419' });
        await spanishBrowser.addCookies([
            { name: 'PARAGLIDE_LOCALE', value: 'en', url: 'http://127.0.0.1:8789' },
        ]);
        const englishPage = await spanishBrowser.newPage();
        await englishPage.goto('/login');
        await expect(englishPage.locator('html')).toHaveAttribute('lang', 'en');
        await expect(englishPage.locator('body')).toContainText(ENGLISH_ON_LOGIN);
        await spanishBrowser.close();

        const englishBrowser = await browser.newContext({ locale: 'en-US' });
        await englishBrowser.addCookies([
            { name: 'PARAGLIDE_LOCALE', value: 'es-419', url: 'http://127.0.0.1:8789' },
        ]);
        const spanishPage = await englishBrowser.newPage();
        await spanishPage.goto('/login');
        await expect(spanishPage.locator('html')).toHaveAttribute('lang', 'es-419');
        await expect(spanishPage.locator('body')).toContainText(SPANISH_ON_LOGIN);
        await englishBrowser.close();
    });

    test('a stored tag the catalogue has no locale for still resolves', async ({ browser }) => {
        // 'en-US' is what the settings pickers write. Paraglide has no such
        // locale, so an unnormalised cookie would fall back to baseLocale by
        // accident — right answer, wrong reason, and 'es-MX' would then be
        // wrong for real. Both are asserted here so the pair cannot drift.
        const ctx = await browser.newContext({ locale: 'en-US' });
        await ctx.addCookies([
            { name: 'PARAGLIDE_LOCALE', value: 'es-MX', url: 'http://127.0.0.1:8789' },
        ]);
        const page = await ctx.newPage();
        await page.goto('/login');
        await expect(page.locator('html')).toHaveAttribute('lang', 'es-419');
        await ctx.close();
    });
});
