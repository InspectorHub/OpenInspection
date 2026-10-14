import { getApiUrl } from "~/lib/api.server";
import { getCloudflareEnv, type LoadContext } from "~/lib/load-context";

/**
 * The caller's credentials for the in-process API. The cookie alone is not
 * enough: the API's session cookie is `SameSite=Strict`, so the landing request
 * after Intuit's cross-site redirect chain arrives without it. The page's own
 * session already yielded the JWT, so it goes along as a Bearer credential.
 */
export interface QboCaller {
  cookie: string;
  token: string;
}

export function qboCaller(request: Request, token: string): QboCaller {
  return { cookie: request.headers.get("Cookie") ?? "", token };
}

export async function qboApiFetch(
  context: LoadContext,
  caller: QboCaller,
  path: string,
  method = "GET",
): Promise<Response | null> {
  try {
    const env = getCloudflareEnv(context);
    const apiBase = getApiUrl(context);
    const req = new Request(`${apiBase}/api/integrations/qbo${path}`, {
      method,
      headers: { Cookie: caller.cookie, Authorization: `Bearer ${caller.token}` },
    });
    return env.API_WORKER ? env.API_WORKER.fetch(req) : fetch(req);
  } catch {
    return null;
  }
}
