# Response security headers

This page describes the security headers a deployment sends, which ones are enforced, which ones only report, and how to move the reporting policy to enforcement.

Two code paths produce responses, and each sets its own headers:

| Response | Where the headers come from |
|---|---|
| API (`/api/*`, webhooks, status) | `server/lib/middleware/security-headers.ts` |
| HTML pages (everything the React Router renderer answers) | `server/lib/page-security-headers.ts`, applied in `workers/app.ts` |

Both build their Content-Security-Policy from one allowlist, `server/lib/csp-policy.ts`, so the two cannot drift apart.

## Enforced on HTML pages

| Header | Value | Why |
|---|---|---|
| `X-Frame-Options` | `SAMEORIGIN` | A page may be framed by a page of the same origin, and by no other site. The app frames none of its own pages except the booking widget pages (below), so this is looser than it needs to be on purpose: it keeps a same-origin frame usable, for example to preview a page at a narrow width. |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Keeps paths and query strings (tokens in links) out of the `Referer` header sent to other sites. |
| `Permissions-Policy` | `geolocation=(), microphone=(), camera=(self)` | The inspection editor opens the camera through `getUserMedia`; nothing uses the microphone or geolocation. |

The widget embed pages, `/book?embed=1` and `/embed/*`, are meant to be placed in an iframe on other sites. They get **no** `X-Frame-Options` and `frame-ancestors *`. Protection for the booking submit comes from the origin allowlist on `POST /api/public/book`, not from framing rules.

This is a behaviour change for pages that were previously unprotected: report, portal and checkout pages now send `X-Frame-Options: SAMEORIGIN`, so a third-party site that puts one of them in an iframe will still see it blank (same-origin framing is allowed, cross-site framing is refused). API responses keep `DENY`. The booking widget routes above stay frameable.

Pages that are redirects, empty answers (204/304) or not HTML get none of these.

## Report-only on HTML pages

Pages carry a `Content-Security-Policy-Report-Only` header. Nothing is blocked; the browser posts a report for each violation to `/api/public/csp-report`. The header holds up to two policies, separated by a comma, and each reports with its own tag:

1. **Policy `a`, the allowlist policy** (`report-uri ...?p=a`). The allowlist the API enforces, plus the hosts only pages load (Stripe.js and its frames, the Cloudflare Stream player and thumbnails; `PAGE_EXTRA_SOURCES` in `server/lib/page-security-headers.ts`), sent on every page. A report against it means a page loads something the allowlist does not know about (a font host, an analytics script, a payment frame).
2. **Policy `b`, the strict policy** (`report-uri ...?p=b`). Policy `a` with `'unsafe-inline'` removed from `script-src` and `style-src`. Reports against it count how much inline script and style the pages use, which is why most of them have `blocked: inline`.

Policy `b` is sent on **one page in 20** per isolate (`STRICT_POLICY_EVERY_NTH_PAGE` in `server/lib/page-security-headers.ts`). The reason is request volume: the legacy `report-uri` mechanism sends one request per violation, and every inline script or style attribute on a page is a violation, so a page sent with the strict policy can cause dozens of requests to the receiver. Sending it on every page would multiply the traffic of the whole deployment. Consequences for reading the logs: counts of `policy: b` lines are a sample, so **multiply them by the sampling number** to estimate the real figure, and compare `b` counts only with other `b` counts.

## Reading the reports

`POST /api/public/csp-report` takes no credentials. Its handler does no database, cache, object-storage, email or queue work and always answers `204` with no body; it does not stop the surrounding middleware from running (tenant resolution may read the tenant cache, and a suspended company's guard can refuse the request before the handler), and a browser that receives anything other than `204` simply drops that report. It writes one structured log line per report, message `csp_report`, with these fields only:

| Field | Meaning |
|---|---|
| `policy` | `a` (allowlist) or `b` (strict, sampled); anything else is `unknown` |
| `disposition` | `report` (report-only policy) or `enforce` |
| `effective_directive` | The directive that was violated, such as `script-src-elem` or `style-src-attr` |
| `blocked` | The blocked resource as an origin only (`https://cdn.example.com`), or a keyword: `inline`, `eval`, `data`, `blob`, `self` |
| `document_path` | The page path, lower-cased, with ids replaced by `:id`; no query string or fragment |
| `source_file_origin` | The origin of the script or stylesheet that triggered it, or `none` |
| `line`, `column` | Position in that file |

The receiver keeps its own volume down. Within each isolate and each one-minute window, once the minute's budget is spent the body is not even read. A report with the same policy, directive, blocked value and page path as one already logged is dropped silently, so a violation that fires on every page view produces one line, not thousands; the set of remembered combinations is capped at 256. After that, at most 30 lines per minute per isolate are written and the rest are dropped without a trace. This means a line is evidence that a combination occurred, not a count of how often. The receiver reads at most 16 KiB per request, counted in raw bytes as received (request bodies are never decompressed). Script samples, referrers, IP addresses, user agents and query strings are never logged.

To read them, filter your log stream for the message `csp_report` and group by `policy`, `effective_directive` and `blocked`. A `blocked` value that is an origin you intend to use is an allowlist gap (policy `a`). A long list of `inline` entries under policy `b` is the inline code the strict policy would block.

## Tightening

1. Collect reports for a representative period (all roles, the booking page, report viewing, payment and signing flows).
2. For every legitimate origin in the policy `a` reports, add it to the matching directive in `server/lib/csp-policy.ts`. The API policy changes with it, so check API responses too.
3. Once the policy `b` reports show no inline script or style you rely on (or you have removed it), remove `'unsafe-inline'` from the policy for `script-src` and `style-src`.
4. Switch the page header from `Content-Security-Policy-Report-Only` to `Content-Security-Policy` in `server/lib/page-security-headers.ts`, keeping `report-uri` so regressions stay visible, and redeploy.
5. Watch the log for `csp_report` lines with `disposition: enforce` after the switch.

The API policy stays enforced throughout; it still allows inline script and style, which is the setting step 3 removes.
