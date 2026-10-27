/**
 * Turning a browser CSP violation report into one safe log line.
 *
 * A report is attacker-controllable input from an unauthenticated caller, and it
 * also describes pages that may carry tokens in their path or query. So nothing
 * is logged verbatim: URLs are cut down to an origin or a keyword, the document
 * path loses anything that looks like an identifier, every string is capped, and
 * the script sample, referrer and query strings are never read at all.
 */
import {
    LegacyCspReportSchema,
    ReportingApiCspReportSchema,
} from './validations/csp-report.schema';

/** Largest request body that is read. A larger body is dropped without parsing. */
export const CSP_REPORT_MAX_BYTES = 16 * 1024;
/** At most this many reports are logged per isolate per window; the rest are dropped silently. */
export const CSP_REPORT_MAX_PER_WINDOW = 30;
export const CSP_REPORT_WINDOW_MS = 60_000;
/** A Reporting API request may batch reports; only this many of one request are looked at. */
const CSP_REPORT_MAX_PER_REQUEST = 5;

const MAX_DIRECTIVE = 40;
const MAX_ORIGIN = 100;
const MAX_PATH = 120;
const MAX_LINE = 10_000_000;

export interface CspReportFields {
    /** Which page policy sent it: `a` (allowlist), `b` (strict, sampled) or `unknown`. */
    policy: 'a' | 'b' | 'unknown';
    disposition: 'report' | 'enforce' | 'unknown';
    effective_directive: string;
    blocked: string;
    document_path: string;
    source_file_origin: string;
    line: number | undefined;
    column: number | undefined;
}

interface RawReport {
    documentUri: string | undefined;
    blockedUri: string | undefined;
    directive: string | undefined;
    disposition: string | undefined;
    sourceFile: string | undefined;
    line: number | undefined;
    column: number | undefined;
}

const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LONG_NUMBER = /^\d{5,}$/;
// A long run of URL-safe characters is a token or an id-bearing slug, not a route word.
const OPAQUE_SEGMENT = /^[\w-]{20,}$/;
const KEYWORD = /^[a-z][a-z-]{0,19}$/;

function originOf(value: string): string {
    try {
        const o = new URL(value).origin;
        return o === 'null' ? '' : o.slice(0, MAX_ORIGIN);
    } catch {
        return '';
    }
}

/** The blocked resource as an origin or a keyword (`inline`, `eval`, `data`, `blob`, `self`, ...); never a path. */
export function reduceBlocked(value: string | undefined): string {
    if (!value) return 'unknown';
    const v = value.trim();
    const lower = v.toLowerCase();
    if (KEYWORD.test(lower)) return lower;
    if (lower.startsWith('data:')) return 'data';
    if (lower.startsWith('blob:')) return 'blob';
    if (lower.startsWith('about:')) return 'about';
    return originOf(v) || 'unknown';
}

/** The page path only, with identifier-looking segments replaced by `:id`. */
export function reduceDocumentPath(value: string | undefined): string {
    if (!value) return 'unknown';
    let pathname: string;
    try {
        pathname = new URL(value).pathname;
    } catch {
        return 'unknown';
    }
    // Lowercased first: the dedupe key must not see `/Login` and `/login` as two pages, and the
    // identifier rules below then never depend on the case a scanner chose.
    const path = pathname
        .toLowerCase()
        .split('/')
        .map((seg) => (UUID_LIKE.test(seg) || LONG_NUMBER.test(seg) || OPAQUE_SEGMENT.test(seg) ? ':id' : seg))
        .join('/');
    return path.slice(0, MAX_PATH) || '/';
}

function reduceDirective(value: string | undefined): string {
    // The legacy `violated-directive` carries the whole policy fragment; the name is its first token.
    const name = (value ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? '';
    return /^[a-z-]+$/.test(name) ? name.slice(0, MAX_DIRECTIVE) : 'unknown';
}

function reduceNumber(value: number | undefined): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    return Math.min(MAX_LINE, Math.max(0, Math.trunc(value)));
}

function reducePolicy(value: string | undefined): CspReportFields['policy'] {
    return value === 'a' || value === 'b' ? value : 'unknown';
}

function toFields(raw: RawReport): CspReportFields {
    return {
        policy: 'unknown',
        disposition: raw.disposition === 'report' || raw.disposition === 'enforce' ? raw.disposition : 'unknown',
        effective_directive: reduceDirective(raw.directive),
        blocked: reduceBlocked(raw.blockedUri),
        document_path: reduceDocumentPath(raw.documentUri),
        source_file_origin: raw.sourceFile ? originOf(raw.sourceFile) || 'unknown' : 'none',
        line: reduceNumber(raw.line),
        column: reduceNumber(raw.column),
    };
}

/** Read both report formats leniently. Anything unrecognised yields no reports. */
export function parseCspReports(body: unknown, policyTag?: string): CspReportFields[] {
    const policy = reducePolicy(policyTag);
    return parseRaw(body).map((f) => ({ ...f, policy }));
}

function parseRaw(body: unknown): CspReportFields[] {
    const legacy = LegacyCspReportSchema.safeParse(body);
    if (legacy.success) {
        const r = legacy.data['csp-report'];
        return [toFields({
            documentUri: r['document-uri'],
            blockedUri: r['blocked-uri'],
            directive: r['effective-directive'] ?? r['violated-directive'],
            disposition: r.disposition,
            sourceFile: r['source-file'],
            line: r['line-number'],
            column: r['column-number'],
        })];
    }
    const api = ReportingApiCspReportSchema.safeParse(body);
    if (!api.success) return [];
    const out: CspReportFields[] = [];
    for (const entry of api.data) {
        if (out.length >= CSP_REPORT_MAX_PER_REQUEST) break;
        const b = entry.body;
        if (entry.type !== 'csp-violation' || !b) continue;
        out.push(toFields({
            documentUri: b.documentURL,
            blockedUri: b.blockedURL,
            directive: b.effectiveDirective,
            disposition: b.disposition,
            sourceFile: b.sourceFile,
            line: b.lineNumber,
            column: b.columnNumber,
        }));
    }
    return out;
}

/** The same violation repeats on every page view; one line per distinct tuple per window is enough. */
const CSP_REPORT_DEDUPE_MAX_KEYS = 256;

let windowStart = 0;
let loggedInWindow = 0;
const seen = new Set<string>();

/**
 * True when the current window has no log budget left. Checked before the body is read, so a
 * flood arriving after the budget is spent costs no read and no parse.
 */
export function cspBudgetExhausted(now: number): boolean {
    if (now - windowStart >= CSP_REPORT_WINDOW_MS || now < windowStart) return false;
    return loggedInWindow >= CSP_REPORT_MAX_PER_WINDOW;
}

/**
 * True when this report may be logged now: not a tuple already seen this window, and within the
 * window's budget. The dedupe runs first so repeats never spend the budget. The set is bounded;
 * once it is full a new tuple is still admitted (budget permitting) but not remembered.
 * Per-isolate state only; no storage involved.
 */
export function admitCspReport(now: number, fields: CspReportFields): boolean {
    if (now - windowStart >= CSP_REPORT_WINDOW_MS || now < windowStart) {
        windowStart = now;
        loggedInWindow = 0;
        seen.clear();
    }
    const key = [fields.policy, fields.effective_directive, fields.blocked, fields.document_path].join('|');
    if (seen.has(key)) return false;
    if (loggedInWindow >= CSP_REPORT_MAX_PER_WINDOW) return false;
    if (seen.size < CSP_REPORT_DEDUPE_MAX_KEYS) seen.add(key);
    loggedInWindow += 1;
    return true;
}

/** Forget the current sampling window. */
export function resetCspReportSampling(): void {
    windowStart = 0;
    loggedInWindow = 0;
    seen.clear();
}

const ACCEPTED_TYPES = ['application/csp-report', 'application/reports+json', 'application/json'];

export function isAcceptedReportType(contentType: string | undefined): boolean {
    const base = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    return ACCEPTED_TYPES.includes(base);
}

/**
 * Read at most `maxBytes` of the body; null when it is larger (nothing past the limit is kept).
 * The cap counts raw wire bytes: nothing here decompresses a request body, so a compressed
 * payload is never expanded.
 */
export async function readCapped(request: Request, maxBytes: number): Promise<string | null> {
    const declared = request.headers.get('content-length');
    if (declared && /^\d+$/.test(declared) && Number(declared) > maxBytes) return null;
    if (!request.body) return '';
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
            await reader.cancel();
            return null;
        }
        chunks.push(value);
    }
    const all = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) {
        all.set(chunk, at);
        at += chunk.byteLength;
    }
    return new TextDecoder().decode(all);
}
