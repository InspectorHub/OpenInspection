/**
 * The canonical OAuth resource for the MCP surface: `<origin>/mcp`.
 *
 * Pure and non-throwing on purpose. The OAuth wrapper is built on every request
 * (not only `/mcp`), so a throw here would turn the home page of a deployment
 * with an unusable `APP_BASE_URL` into a 500. A null return lets the caller
 * keep serving everything outside the OAuth and MCP surface.
 */
export function resourceUrlFor(env: { APP_BASE_URL?: string }, req?: Request): string | null {
    let origin: URL;
    try {
        origin = new URL(env.APP_BASE_URL ? new URL(env.APP_BASE_URL).origin : req ? new URL(req.url).origin : '');
    } catch {
        return null;
    }
    const loopback = origin.hostname === 'localhost' || origin.hostname === '[::1]' || /^127\./.test(origin.hostname);
    if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && loopback)) return null;
    return `${origin.origin}/mcp`;
}
