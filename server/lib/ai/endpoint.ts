/**
 * Turn a configured base URL into the value recorded as the destination of an
 * AI call.
 *
 * WHAT IS DROPPED, AND WHY IT IS DROPPED STRUCTURALLY. `URL.origin` and
 * `URL.pathname` do not include userinfo, query or fragment — that is the
 * definition of those properties, not a filter applied to them. A base URL may
 * legally carry `user:password@`, and the endpoint at which a workspace saves
 * one validates only its length, so a verbatim copy could put a credential into
 * `ai_call_provenance` — a table the assurance export hands out.
 *
 * WHAT IS KEPT, AND WHY. The path stays: some backends encode a processing
 * region or a project in it, and the region is precisely the fact this column
 * exists to answer ("where is inspection text processed", CLAUDE.md on
 * `AI_BASE_URL`). The cost is that a path may itself be an identifier, which is
 * why the assurance export's reviewers see it.
 *
 * A trailing slash is removed so one destination records one way; `https://h/v1`
 * and `https://h/v1/` are the same endpoint and `chatCompletionsUrl` already
 * treats them alike.
 *
 * `'unparseable'` rather than a throw or a verbatim copy: this runs on the AI
 * path, where an exception would turn a configuration problem into a refused
 * call, and it reads values stored before the save endpoint validated anything.
 * It mirrors `deriveProviderId`, which answers `'unknown'` for the same reason.
 */
export function normaliseEndpoint(baseUrl: string): string {
    try {
        const url = new URL(baseUrl);
        return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
    } catch {
        return 'unparseable';
    }
}
