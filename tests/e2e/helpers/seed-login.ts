/**
 * Log in as one of the multi-user seed accounts (`tests/seed-fixtures.ts`).
 *
 * The subsystem-D/E specs are the only ones driving those accounts, and they all
 * need the same three lines plus the redirect wait. The wait is the part worth
 * sharing: without it the next `page.goto` races the login navigation and the
 * spec fails somewhere else entirely.
 *
 * Requires `SEED_E2E=1` — globalSetup only writes these rows when it is set, and
 * since the seed now throws on failure a missing account is a hard error rather
 * than a mystery 401.
 */
import { expect, type APIResponse, type Page } from '@playwright/test';
import { SEED_PASSWORD } from '../../seed-fixtures';

export async function loginAsSeedUser(page: Page, email: string): Promise<void> {
    await page.goto('/login');
    await page.fill('input[name=email]', email);
    await page.fill('input[name=password]', SEED_PASSWORD);
    await page.click('button[type=submit]');
    await page.waitForURL('**/inspections', { timeout: 15_000 });
}

/**
 * Headers for a `page.request` write on behalf of the logged-in page.
 *
 * The API's CSRF check is a stateless double-submit: the `__Host-csrf_token`
 * cookie must equal the `x-csrf-token` header. The trap is that an explicit
 * `Cookie:` header REPLACES the context's jar rather than adding to it, so
 * sending only the CSRF cookie logs the request out — a 401 "No role found in
 * context" that reads like an authorization bug and is really a lost session.
 * So the auth cookie is read back out of the jar and re-sent alongside.
 */
async function authedWriteHeaders(page: Page): Promise<Record<string, string>> {
    const token = Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    const jar = await page.context().cookies();
    const cookieHeader = [
        ...jar.map((c) => `${c.name}=${c.value}`),
        `__Host-csrf_token=${token}`,
    ].join('; ');
    return {
        'Content-Type': 'application/json',
        'X-CSRF-Token': token,
        Cookie: cookieHeader,
    };
}

/**
 * GET on behalf of the logged-in page, with the jar re-sent explicitly.
 *
 * Same reason as the POST below: `page.request` does not reliably carry the
 * `__Host-` session cookie for a bare API call, and the failure is not a clean
 * 401 — the request lands with a role but no tenant-scoped DB and the handler
 * throws "ScopedDB session missing" as a 500. Re-sending the jar removes the
 * ambiguity entirely.
 */
export async function apiGet(page: Page, path: string): Promise<APIResponse> {
    return page.request.get(path, { headers: await authedWriteHeaders(page) });
}

/** POST that fails loudly — a swallowed 4xx in setup turns the whole spec into a no-op. */
export async function apiPost(
    page: Page,
    path: string,
    body: Record<string, unknown>,
): Promise<void> {
    const res = await page.request.post(path, {
        headers: await authedWriteHeaders(page),
        data: body,
    });
    expect(res.status(), `${path} -> ${await res.text()}`).toBe(200);
}
