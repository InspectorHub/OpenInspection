// server/lib/messaging/twilio-http-client.ts
// Minimal fetch-backed RequestClient for twilio-node, so the SDK runs on
// Cloudflare Workers without its default axios/node-http transport (which is
// not edge-safe). Implements only what twilio-node calls: request(opts).
export interface TwilioRequestOptions {
  method: string;
  uri: string;
  username?: string;
  password?: string;
  headers?: Record<string, string>;
  params?: Record<string, string>;
  data?: Record<string, unknown>;
  timeout?: number;
}
export interface TwilioResponse<T = unknown> { statusCode: number; body: T; headers: Record<string, string>; }

export function createFetchHttpClient() {
  return {
    async request<T = unknown>(opts: TwilioRequestOptions): Promise<TwilioResponse<T>> {
      const url = new URL(opts.uri);
      for (const [k, v] of Object.entries(opts.params ?? {})) url.searchParams.append(k, String(v));
      const headers: Record<string, string> = { ...(opts.headers ?? {}) };
      if (opts.username != null) headers['Authorization'] = `Basic ${btoa(`${opts.username}:${opts.password ?? ''}`)}`;
      const init: RequestInit = { method: opts.method, headers };
      if (opts.data && Object.keys(opts.data).length) {
        headers['Content-Type'] = headers['Content-Type'] ?? 'application/x-www-form-urlencoded';
        init.body = new URLSearchParams(opts.data as Record<string, string>).toString();
      }
      const res = await fetch(url.toString(), init);
      const text = await res.text();
      let parsed: unknown = text;
      try { parsed = text ? JSON.parse(text) : {}; } catch { /* keep text */ }
      const outHeaders: Record<string, string> = {};
      res.headers.forEach((val, key) => { outHeaders[key] = val; });
      return { statusCode: res.status, body: parsed as T, headers: outHeaders };
    },
  };
}
