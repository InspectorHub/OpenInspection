/**
 * Server-side API client for calling the Hono API from Remix loaders/actions.
 *
 * Two clients are available:
 *
 * 1. `createApi(token?)` — typed RPC client via `hc<CoreApiType>()`. Provides
 *    full autocompletion for every chained `.route()` endpoint. Preferred for
 *    new code.
 *
 * 2. `apiFetch(path, init?)` — low-level fetch wrapper. Kept as a fallback
 *    for routes not yet captured by the hc<> type (inline `app.get('/api/...')`
 *    handlers) and for CSRF double-submit flows.
 */

import { hc } from "hono/client";
import type { CoreApiType } from "../../../packages/api-types";

function getApiUrl(): string {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const fromEnv =
    typeof process !== "undefined" ? process.env?.API_URL : undefined;
  return fromEnv || "http://localhost:8788";
}

/**
 * Typed RPC client for the Hono API. Routes registered via chained `.route()`
 * calls in `api/src/index.ts` are captured in `CoreApiType` — e.g.:
 *
 * ```ts
 * const api = createApi(token);
 * const res = await api.api.inspections.$get();
 * ```
 *
 * Known limitation: the deeply nested `MergeSchemaPath<>` intersection in
 * `CoreApiType` exceeds TypeScript's structural check depth for `hc<T>`'s
 * `T extends Hono<any,any,any>` constraint. The cast bridges this gap.
 * Once sub-routers also chain their `.openapi()` calls (instead of void),
 * the type will carry full request/response shapes.
 */
export function createApi(token?: string) {
  // @ts-expect-error — CoreApiType's 43-deep MergeSchemaPath intersection
  // exceeds TS's structural check depth for hc<T>'s `T extends Hono<any,any,any>`.
  // The returned client is still typed at call-sites once sub-routers chain
  // their .openapi() calls.
  return hc<CoreApiType>(getApiUrl(), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
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
