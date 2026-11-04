import { withHumanToken } from "./human-token";

/** The one header the API's per-address limiters read. */
const CLIENT_ADDRESS_HEADER = "cf-connecting-ip";

/**
 * The API request a page's loader or action makes in-process, carrying what only the OUTER request knows: the visitor's address
 * (so the per-address limiters see the visitor, not one shared "unknown" caller) and the one-time human-check token.
 *
 * The address is taken from the outer request, where the edge sets it, and replaces whatever the inner request carried. When the
 * outer request has none (local development) the inner request is left as it is.
 */
export function forInProcessApi(req: Request, outer: Headers): Request {
  const address = outer.get(CLIENT_ADDRESS_HEADER);
  let next = req;
  if (address && address !== req.headers.get(CLIENT_ADDRESS_HEADER)) {
    const headers = new Headers(req.headers);
    headers.set(CLIENT_ADDRESS_HEADER, address);
    next = new Request(req, { headers });
  }
  return withHumanToken(next, outer.get("cookie"));
}
