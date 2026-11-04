/**
 * Whether a POST came from a page of another site.
 *
 * Two public actions sign the visitor in from a code in the URL (the portal link and the agent link). A page on another site could
 * post a form to them with a code the attacker owns, and the visitor's browser would be signed in to the attacker's account. A request
 * is refused as cross-site when the browser says so (`Sec-Fetch-Site: cross-site`), when it says `same-site` without an `Origin` that
 * is ours (a sibling subdomain is another origin), or when an `Origin` header is present and is not this request's origin (`null`
 * included). `same-origin`, `none` (typed in or bookmarked) and a request that carries neither header (an older client) are allowed.
 */
export function isCrossSitePost(request: Request): boolean {
    const site = request.headers.get("sec-fetch-site");
    if (site === "cross-site") return true;
    const origin = request.headers.get("origin");
    if (origin !== null) return origin !== new URL(request.url).origin;
    return site === "same-site";
}
