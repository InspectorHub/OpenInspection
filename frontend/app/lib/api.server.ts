/**
 * Server-side API client for calling the Hono API from Remix loaders/actions.
 *
 * Uses plain `fetch` rather than hono/client because the API routes use
 * OpenAPI-style `createRoute()` which doesn't produce the chained type
 * signature that `hc<T>()` needs.
 */

function getApiUrl(): string {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const fromEnv =
    typeof process !== "undefined" ? process.env?.API_URL : undefined;
  return fromEnv || "http://localhost:8788";
}

/**
 * Low-level fetch wrapper that targets the Hono API Worker.
 *
 * - Automatically sets JSON content-type
 * - Attaches Bearer token when provided
 * - Handles CSRF double-submit for endpoints that require it (e.g. login)
 */
export async function apiFetch(
  path: string,
  init?: RequestInit & { token?: string; csrf?: boolean },
): Promise<Response> {
  const url = `${getApiUrl()}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.token ? { Authorization: `Bearer ${init.token}` } : {}),
  };

  // CSRF double-submit: the API requires both a __Host-csrf_token cookie and
  // a matching x-csrf-token header for state-changing public endpoints (login,
  // register, etc.).  Since this runs server-to-server we mint the token here.
  if (init?.csrf) {
    const csrfToken = crypto.randomUUID().replace(/-/g, "");
    headers["x-csrf-token"] = csrfToken;
    // __Host- prefix requires Secure; the local miniflare instance may or may
    // not honour it.  For dev we also send a non-prefixed variant.
    const cookieHeader = `__Host-csrf_token=${csrfToken}`;
    headers["Cookie"] = init?.headers
      ? `${(init.headers as Record<string, string>)["Cookie"] || ""}; ${cookieHeader}`
      : cookieHeader;
  }

  const { token: _token, csrf: _csrf, ...rest } = init ?? {};
  return fetch(url, {
    ...rest,
    headers: { ...headers, ...(rest.headers as Record<string, string>) },
  });
}
