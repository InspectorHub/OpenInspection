/**
 * The most inspections one delete request may carry. Every delete is a full
 * cascade (tens of database and storage calls, more with many files) and a
 * request is one Worker invocation. Cloudflare documents 50 external and 1,000
 * Cloudflare-service subrequests per invocation on the Free plan (10,000 on
 * Paid, 10 ms CPU on Free), so 10 cascades keeps a typical batch well inside the
 * lower figure. The page sends larger selections in chunks of this size, one
 * after another; the server refuses a request that names more.
 */
export const MAX_DELETE_BATCH = 10;
