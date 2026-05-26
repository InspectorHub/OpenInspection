import { hc } from "hono/client";
import type { CoreApiType } from "../../../packages/api-types";

function getApiUrl(): string {
  // Pages deploy: _worker.js sets globalThis.__API_URL from env.API_URL
  const g = globalThis as Record<string, unknown>;
  if (typeof g.__API_URL === "string" && g.__API_URL) return g.__API_URL;
  // Dev / CI: process.env is available
  try {
    if (typeof process !== "undefined" && process?.env?.API_URL) {
      return process.env.API_URL;
    }
  } catch {}
  return "http://localhost:8788";
}

export function createApi(token?: string) {
  // @ts-expect-error — CoreApiType's deep intersection exceeds TS structural check
  return hc<CoreApiType>(getApiUrl(), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

export async function apiFetch(
  path: string,
  init?: RequestInit & { token?: string; csrf?: boolean },
): Promise<Response> {
  const url = `${getApiUrl()}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.token ? { Authorization: `Bearer ${init.token}` } : {}),
  };

  if (init?.csrf) {
    const csrfToken = crypto.randomUUID().replace(/-/g, "");
    headers["x-csrf-token"] = csrfToken;
    const cookieHeader = `__Host-csrf_token=${csrfToken}`;
    headers["Cookie"] = init?.headers
      ? `${(init.headers as Record<string, string>)["Cookie"] || ""}; ${cookieHeader}`
      : cookieHeader;
  }

  const { token: _token, csrf: _csrf, ...rest } = init ?? {};
  const finalHeaders = { ...headers, ...(rest.headers as Record<string, string>) };

  // Service Bindings: when API_WORKER env binding is available, use it
  // to avoid CF internal routing 404 on Worker-to-Worker fetch.
  // The binding is injected at runtime via globalThis.__API_WORKER.
  const apiWorker = (globalThis as Record<string, unknown>).__API_WORKER as
    | { fetch: typeof fetch }
    | undefined;
  if (apiWorker) {
    return apiWorker.fetch(new Request(url, { ...rest, headers: finalHeaders }));
  }

  return fetch(url, { ...rest, headers: finalHeaders });
}
