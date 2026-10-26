/**
 * What these helpers need from an API reply. The typed client's reply is structurally a Response but
 * does not carry the Workers-only members of the global type, so asking for `Response` would reject it.
 */
export interface ApiReply {
  ok: boolean;
  text(): Promise<string>;
}

/**
 * The message a refused API call carries ({ error: { message } } or { message }), or `fallback`
 * when the body is missing, is not JSON, or has no message. Only text the server already chose
 * to send is passed on.
 */
export async function refusalMessage(res: ApiReply, fallback: string): Promise<string> {
  const bodyText = await res.text().catch(() => "");
  try {
    const parsed = JSON.parse(bodyText) as { error?: { message?: string }; message?: string };
    return parsed?.error?.message ?? parsed?.message ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Runs a typed-client call and returns its Response, or null when it threw. The client can throw
 * synchronously (before any promise exists) as well as reject, so the call is made inside the try.
 */
export async function attempt<T extends ApiReply>(call: () => Promise<T>): Promise<T | null> {
  try {
    return await call();
  } catch {
    return null;
  }
}
