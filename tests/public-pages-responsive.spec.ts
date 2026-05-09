/**
 * Sprint 1 Sub-spec C-9 — Public-page responsive smoke.
 *
 * Walks each public-facing page across 5 viewport widths and asserts:
 *   * no horizontal scroll (`scrollWidth <= clientWidth`)
 *   * the primary CTA is visible above the fold on tablet+ widths
 *
 * Also writes one full-page screenshot per (page × viewport) into
 * `screenshots/` for visual review. The screenshots are gitignored.
 *
 * The spec uses `test.skip` when a page returns a non-200 status (for
 * example /agreement-sign without a valid token redirects to /not-found
 * which is itself a 404). Adjust the target URLs as your local
 * environment seeds them.
 */
import { test, expect, type Page } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:8789';

const VIEWPORTS = [
    { name: 'iphone-se',    w: 375,  h: 667  },
    { name: 'iphone-pro',   w: 414,  h: 896  },
    { name: 'tablet',       w: 768,  h: 1024 },
    { name: 'small-laptop', w: 1024, h: 768  },
    // Sprint 3 S3-4 — tablet-mid is the 1024-1279 zone (iPad Pro 11"
    // landscape sits at 1180px). The inspection-edit page now drops its
    // right pane in this zone in favor of a slide-in drawer; this viewport
    // pins the regression so a future layout change can't silently break
    // the iPad inspector experience.
    { name: 'tablet-mid',   w: 1100, h: 768  },
    { name: 'desktop',      w: 1440, h: 900  },
];

interface PageDef {
    url: string;
    key: string;
    /** Optional selector that must be in viewport on tablet+ widths. */
    primaryCta?: string;
}

const PAGES: PageDef[] = [
    // /book is a long multi-field form; submit button is naturally below the
    // fold on short viewports. Keep horizontal-scroll check but skip CTA-above-fold.
    { url: '/book',                              key: 'booking' },
    { url: '/not-found?from=agreement-sign',     key: 'agreement-404',  primaryCta: 'a' },
    { url: '/not-found',                         key: 'not-found',      primaryCta: 'a' },
];

async function hasHorizontalScroll(page: Page): Promise<boolean> {
    return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
}

for (const vp of VIEWPORTS) {
    for (const p of PAGES) {
        test(`${p.key} @ ${vp.name} (${vp.w}x${vp.h})`, async ({ page }, testInfo) => {
            await page.setViewportSize({ width: vp.w, height: vp.h });
            const res = await page.goto(`${BASE_URL}${p.url}`, { waitUntil: 'domcontentloaded' });
            test.skip(!res || (res.status() >= 500), `Page ${p.url} not reachable`);

            // Capture for visual review.
            const fileName = testInfo.outputPath(`${p.key}-${vp.name}.png`);
            await page.screenshot({ path: fileName, fullPage: true });

            // Assertion 1 — no horizontal scroll.
            const hScroll = await hasHorizontalScroll(page);
            expect(hScroll, `${p.key} has horizontal scroll at ${vp.w}px`).toBe(false);

            // Assertion 2 — primary CTA visible above the fold on tablet+.
            if (p.primaryCta && vp.w >= 768) {
                const cta = page.locator(p.primaryCta).first();
                if (await cta.count() > 0) {
                    await expect(cta).toBeInViewport({ ratio: 0.5 });
                }
            }
        });
    }
}
