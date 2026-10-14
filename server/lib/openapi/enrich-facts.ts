/**
 * The schema-derived FACTS half of enrichDescriptions: which fact a schema node
 * states (length, range, enum, default, format), and whether a hand-written
 * description already says it. Pure string and object reads; the document walk
 * that applies them lives in enrich-descriptions.ts.
 */
import { MIN_FIELD_DESCRIPTION_CHARS } from '../route-metadata-standards';

export type Json = Record<string, unknown>;

const PLACEHOLDER_PHRASES = [['Auto-generated', 'placeholder'].join(' '), ['TODO', 'describe'].join(' ')] as const;
const ENUM_CAP = 20;
const DEFAULT_CAP = 40;

export function isRec(value: unknown): value is Json {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True for an absent, blank, or placeholder description. */
export function isPlaceholderDescription(description: unknown): boolean {
    if (typeof description !== 'string' || description.trim() === '') return true;
    return PLACEHOLDER_PHRASES.some((phrase) => description.includes(phrase));
}

/** Hand-written and long enough to stand on its own. */
export function isSemantic(description: unknown): description is string {
    return typeof description === 'string'
        && !isPlaceholderDescription(description)
        && description.trim().length >= MIN_FIELD_DESCRIPTION_CHARS;
}

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

/** One condition under which the prose is taken to state a fact already. */
interface Check {
    /** Every value must appear in the prose as a whole token. */
    values: string[];
    /** And the prose must use wording from this family. */
    keywords: RegExp;
}

interface Fact {
    text: string;
    checks: Check[];
}

const ANY = /[\s\S]/;
const RANGE_WORDS = /between|range|at least|at most|minimum|maximum|\bmin\b|\bmax\b|greater|less than|from|up to|\bto\b/i;
const LENGTH_WORDS = /\bchars?\b|characters|length|long\b/i;
const ITEM_WORDS = /\bitems?\b|entries|elements/i;

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** One pattern per distinct value, built once per isolate rather than once per field. */
const TOKEN_PATTERNS = new Map<string, RegExp>();

function hasToken(prose: string, value: string): boolean {
    let re = TOKEN_PATTERNS.get(value);
    if (!re) {
        re = new RegExp(`(?<![A-Za-z0-9_.])${escapeRegex(value)}(?![A-Za-z0-9_])`, 'i');
        TOKEN_PATTERNS.set(value, re);
    }
    return re.test(prose);
}

function normalize(text: string): string {
    return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function covered(prose: string, fact: Fact): boolean {
    if (normalize(prose).includes(normalize(fact.text))) return true;
    return fact.checks.every((c) => c.keywords.test(prose) && c.values.every((v) => hasToken(prose, v)));
}

function num(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

interface Bound {
    value: number;
    exclusive: boolean;
}

function bounds(node: Json): { lower?: Bound; upper?: Bound } {
    const out: { lower?: Bound; upper?: Bound } = {};
    const min = num(node['minimum']);
    const max = num(node['maximum']);
    const exMin = node['exclusiveMinimum'];
    const exMax = node['exclusiveMaximum'];
    if (num(exMin) !== undefined) out.lower = { value: num(exMin) as number, exclusive: true };
    else if (min !== undefined) out.lower = { value: min, exclusive: exMin === true };
    if (num(exMax) !== undefined) out.upper = { value: num(exMax) as number, exclusive: true };
    else if (max !== undefined) out.upper = { value: max, exclusive: exMax === true };
    return out;
}

function numericFact(node: Json, name: string | undefined): Fact | undefined {
    const type = node['type'];
    if (type !== 'integer' && type !== 'number') return undefined;
    const cents = name !== undefined && /Cents$/.test(name);
    const head = cents ? 'Integer cents' : type === 'integer' ? 'Integer' : '';
    const { lower, upper } = bounds(node);
    const checks: Check[] = [];
    if (head) checks.push({ values: [], keywords: cents ? /\bcents\b/i : /\binteger\b/i });

    let range: string;
    let joiner = ', ';
    if (lower && upper && !lower.exclusive && !upper.exclusive) {
        range = `between ${lower.value} and ${upper.value}`;
        joiner = ' ';
    } else {
        const parts: string[] = [];
        if (lower) parts.push(`${lower.exclusive ? 'greater than' : 'at least'} ${lower.value}`);
        if (upper) parts.push(`${upper.exclusive ? 'less than' : 'at most'} ${upper.value}`);
        range = parts.join(' and ');
    }
    if (range) {
        const values = [lower?.value, upper?.value].filter((v): v is number => v !== undefined).map(String);
        checks.push({ values, keywords: RANGE_WORDS });
    }
    if (!head && !range) return undefined;
    const text = head && range
        ? `${head}${joiner}${range}.`
        : head ? `${head}.` : `${range.charAt(0).toUpperCase()}${range.slice(1)}.`;
    return { text, checks };
}

/** `1-200 characters.` / `Up to 80 characters.` / `At least 3 characters.` (a lone minLength of 1 is the required flag, not a fact). */
function sizeFact(
    node: Json, minKey: string, maxKey: string, unit: string, keywords: RegExp, singleMinIsNoise: boolean,
): Fact | undefined {
    const min = num(node[minKey]);
    const max = num(node[maxKey]);
    if (min === undefined && max === undefined) return undefined;
    if (max === undefined && min === 1 && singleMinIsNoise) return undefined;
    const values = [min, max].filter((v): v is number => v !== undefined).map(String);
    let text: string;
    if (min !== undefined && max !== undefined) text = `${min}-${max} ${unit}.`;
    else if (max !== undefined) text = `Up to ${max} ${unit}.`;
    else text = `At least ${min} ${unit}.`;
    return { text, checks: [{ values, keywords }] };
}

function enumFact(node: Json): Fact | undefined {
    const raw = node['enum'];
    if (!Array.isArray(raw)) return undefined;
    const values = raw.filter((v): v is string | number | boolean => v !== null && v !== undefined);
    if (values.length === 0 || values.length > ENUM_CAP) return undefined;
    if (!values.every((v) => ['string', 'number', 'boolean'].includes(typeof v))) return undefined;
    const shown = values.map(String);
    return { text: `One of: ${shown.join(', ')}.`, checks: [{ values: shown, keywords: ANY }] };
}

function defaultFact(node: Json): Fact | undefined {
    const d = node['default'];
    let shown: string;
    if (typeof d === 'string') {
        if (d.length > DEFAULT_CAP) return undefined;
        shown = d === '' ? '""' : d;
    } else if (typeof d === 'number' || typeof d === 'boolean') shown = String(d);
    else return undefined;
    return { text: `Defaults to ${shown}.`, checks: [{ values: d === '' ? [] : [shown], keywords: /default/i }] };
}

const FORMATS: Readonly<Record<string, { text: string; keywords: RegExp }>> = {
    'date-time': { text: 'ISO 8601 date-time.', keywords: /iso ?8601|date-?time|timestamp/i },
    date: { text: 'Date in YYYY-MM-DD format.', keywords: /yyyy-mm-dd|iso date/i },
    email: { text: 'Must be a valid email address.', keywords: /e-?mail/i },
};

function formatFact(node: Json): Fact | undefined {
    const f = typeof node['format'] === 'string' ? FORMATS[node['format']] : undefined;
    return f ? { text: f.text, checks: [{ values: [], keywords: f.keywords }] } : undefined;
}

export function allFacts(node: Json, name: string | undefined): Fact[] {
    return [
        numericFact(node, name),
        sizeFact(node, 'minLength', 'maxLength', 'characters', LENGTH_WORDS, true),
        sizeFact(node, 'minItems', 'maxItems', 'items', ITEM_WORDS, false),
        enumFact(node),
        formatFact(node),
        defaultFact(node),
    ].filter((f): f is Fact => f !== undefined);
}

/** Append the facts the prose does not already state. Returns `prose` itself when nothing is missing. */
export function appendFacts(prose: string, facts: Fact[]): string {
    const missing = facts.filter((f) => !covered(prose, f));
    if (missing.length === 0) return prose;
    const base = prose.trim();
    const stop = /[.!?]$/.test(base) ? base : `${base}.`;
    return `${stop} ${missing.map((f) => f.text).join(' ')}`;
}
