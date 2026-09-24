/**
 * ISN (Inspection Support Network) — credentials and the one HTTP call.
 *
 * Two facts about this API decide everything below, and neither is in its spec
 * (developer.inspectionsupport.com, OpenAPI "v8665"). Both were taken off the
 * wire against a live company on 2026-09-18:
 *
 *   1. ISN answers HTTP 200 to errors — a rejected login, an unknown path, a
 *      wrong verb, a missing field all come back as 200 with
 *      `{ "status": "error", "message": ... }`. A call succeeds only when the
 *      BODY says `status: "ok"`; the status code carries no information.
 *   2. Fields travel in the QUERY STRING. The spec documents PUT bodies as
 *      form-encoded, but `PUT /orders/addreporturl` ignores a form body and
 *      answers "you must provide a url for the report". The same fields in the
 *      query string are read. See tests/contract/isn/isn-api.live.spec.ts.
 */

/** Everything needed to reach one company's ISN. */
export interface IsnConfig {
    /** e.g. https://inspectionsupport.com — white-label companies have their own. */
    domain: string;
    companyKey: string;
    accessKey: string;
    secretKey: string;
}

type IsnEnv = Partial<Record<'ISN_DOMAIN' | 'ISN_COMPANY_KEY' | 'ISN_ACCESS_KEY' | 'ISN_SECRET_KEY', string>>;

/**
 * Null unless all four are set — the integration is simply off. There is no
 * default domain: ISN is white-labelled (4isn.com, goisn.net, ...), and a
 * guessed host fails looking exactly like a bad access key.
 */
export function isnConfig(env: IsnEnv): IsnConfig | null {
    const domain = env.ISN_DOMAIN?.trim().replace(/\/+$/, '');
    const companyKey = env.ISN_COMPANY_KEY?.trim();
    const accessKey = env.ISN_ACCESS_KEY?.trim();
    const secretKey = env.ISN_SECRET_KEY?.trim();
    if (!domain || !companyKey || !accessKey || !secretKey) return null;
    return { domain, companyKey, accessKey, secretKey };
}

/** ISN's own words, kept whole — see docs/develop/integration-adapters.md. */
export class IsnError extends Error {
    constructor(readonly operation: string, readonly isnMessage: string, readonly httpStatus: number) {
        super(`ISN ${operation}: ${isnMessage}`);
        this.name = 'IsnError';
    }
}

export type IsnBody = { status?: string; message?: string } & Record<string, unknown>;

/** One call. Throws IsnError unless the body says `status: "ok"`. */
export async function isnCall(
    cfg: IsnConfig, method: 'GET' | 'PUT' | 'DELETE', path: string, params?: Record<string, string>,
): Promise<IsnBody> {
    const qs = params ? `?${new URLSearchParams(params).toString()}` : '';
    const res = await fetch(`${cfg.domain}/${encodeURIComponent(cfg.companyKey)}/rest${path}${qs}`, {
        method,
        headers: { Authorization: `Basic ${btoa(`${cfg.accessKey}:${cfg.secretKey}`)}`, Accept: 'application/json' },
    });
    const text = await res.text();
    let body: IsnBody | null = null;
    try { body = JSON.parse(text) as IsnBody; } catch { /* not JSON — reported below */ }
    if (body?.status !== 'ok') {
        const message = body?.message || (body ? 'no status in response' : `non-JSON response: ${text.slice(0, 200)}`);
        throw new IsnError(`${method} ${path}`, message, res.status);
    }
    return body;
}
