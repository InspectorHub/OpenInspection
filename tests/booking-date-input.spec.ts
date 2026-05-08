/**
 * R7-06 — /book Inspection Date input is a native date picker.
 *
 * The original implementation used <input type="text"> with a JS mask so the
 * placeholder stayed locale-stable ("MM / DD / YYYY"). On mobile Safari this
 * meant the soft keyboard came up as a free-text keyboard rather than the
 * native iOS date spinner — brittle and slow.
 *
 * Switching to type="date" gives every browser its native picker (iOS spinner,
 * Android calendar, desktop popover) and the value is always serialized as
 * the locale-stable ISO "YYYY-MM-DD" — so the placeholder leak that the old
 * mask was working around no longer matters.
 */
import { test, expect } from '@playwright/test';

test.describe('R7-06 — /book inspection date input', () => {
    test('uses native date picker (type=date)', async ({ page }) => {
        await page.goto('/book');
        const dateInput = page.locator('input[name="inspectionDate"]');
        await expect(dateInput).toHaveCount(1);
        const type = await dateInput.getAttribute('type');
        expect(['date', 'datetime-local']).toContain(type);
    });

    test('accepts an ISO YYYY-MM-DD value and round-trips it', async ({ page }) => {
        await page.goto('/book');
        const dateInput = page.locator('input[name="inspectionDate"]');
        // A date a few days in the future so the validation passes.
        const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        const iso = future.toISOString().slice(0, 10); // "YYYY-MM-DD"
        await dateInput.fill(iso);
        await dateInput.blur();
        await expect(dateInput).toHaveValue(iso);
        // The error region should stay hidden when the date is valid + in
        // the future. (Alpine sets style="display:none" via x-show.)
        const err = page.locator('#date-error');
        const display = await err.evaluate((el) => getComputedStyle(el).display);
        expect(display).toBe('none');
    });

    test('shows an error when a past date is selected', async ({ page }) => {
        await page.goto('/book');
        // Wait for Alpine to load (loaded with `defer`, runs `bookingPage()`
        // factory on alpine:init) — the date input becomes visible to
        // `dateInput.fill()` once the input is rendered.
        const dateInput = page.locator('input[name="inspectionDate"]');
        await expect(dateInput).toBeVisible();
        // Give Alpine a beat to attach event listeners after the script
        // finishes parsing.
        await page.waitForTimeout(500);
        // 30 days ago.
        const past = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const iso = past.toISOString().slice(0, 10);
        await dateInput.fill(iso);
        // Fire the events Alpine listens to: x-model picks up `input`, our
        // explicit handler is on `change` + `blur`. Dispatching both manually
        // ensures the validator runs even when the headless browser collapses
        // focus events.
        await dateInput.evaluate((el: HTMLInputElement) => {
            el.dispatchEvent(new Event('input',  { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('blur',   { bubbles: true }));
        });
        // x-show sets style.display; poll the message text directly.
        await expect(page.locator('#date-error')).toContainText(/past/i, { timeout: 5000 });
    });
});
