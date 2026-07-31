/** Request-derived origin when APP_BASE_URL is unset (local /preview). */
export function getBaseUrlFromRequest(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

/**
 * Rewrite hosted `/legal/...` absolute URLs onto the browser-facing origin.
 * Custom tenant websites (any other path/host) are left unchanged.
 *
 * In-process API calls often yield `http://localhost/legal/...` without the
 * wrangler port — unusable for footers and TFV copy until rebased.
 */
export function rebaseHostedLegalUrl(
  url: string | null | undefined,
  origin: string,
): string | null {
  if (!url) return null;
  const base = origin.replace(/\/$/, "");
  try {
    const u = new URL(url);
    if (!u.pathname.startsWith("/legal/")) return url;
    return `${base}${u.pathname}${u.search}`;
  } catch {
    if (url.startsWith("/legal/")) return `${base}${url}`;
    return url;
  }
}
