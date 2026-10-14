/**
 * enrichDescriptions — appends schema-derived FACTS to hand-written input
 * descriptions in an OpenAPI document.
 *
 * Division of labour: a person writes what a field or route is FOR; this module
 * states what the schema already says about its SHAPE (length, range, enum,
 * default, format), so that half of a description cannot drift from the zod
 * schema it was read from.
 *
 * Three rules keep it from becoming boilerplate:
 *   1. It only ever appends to a description that is already semantic, meaning
 *      non-placeholder and at least MIN_FIELD_DESCRIPTION_CHARS long on its own.
 *      A short or placeholder text is returned untouched, so the suffix can never
 *      lift a description over the length floor; the route-metadata gate keeps
 *      catching exactly what it caught before.
 *   2. It never writes a description where there is none. The single exception
 *      is a path parameter named `id`, whose meaning is fully determined by the
 *      route (`/contacts/{id}`), and only when the entity name can be derived by
 *      a conservative rule.
 *   3. A fact the prose already states is not repeated (see `covered`), which
 *      also makes the function idempotent.
 *
 * Pure and WinterCG-safe: it deep-copies the document and returns the copy.
 */
import { MIN_FIELD_DESCRIPTION_CHARS } from '../route-metadata-standards';

type Json = Record<string, unknown>;

const PLACEHOLDER_PHRASES = ['Auto-generated placeholder', 'TODO describe'] as const;
const COMPONENT_PREFIX = '#/components/schemas/';
const ENUM_CAP = 20;
const DEFAULT_CAP = 40;

function isRec(value: unknown): value is Json {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True for an absent, blank, or placeholder description. */
export function isPlaceholderDescription(description: unknown): boolean {
    if (typeof description !== 'string' || description.trim() === '') return true;
    return PLACEHOLDER_PHRASES.some((phrase) => description.includes(phrase));
}

/** Hand-written and long enough to stand on its own. */
function isSemantic(description: unknown): description is string {
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

function hasToken(prose: string, value: string): boolean {
    return new RegExp(`(?<![A-Za-z0-9_.])${escapeRegex(value)}(?![A-Za-z0-9_])`, 'i').test(prose);
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

function allFacts(node: Json, name: string | undefined): Fact[] {
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
function appendFacts(prose: string, facts: Fact[]): string {
    const missing = facts.filter((f) => !covered(prose, f));
    if (missing.length === 0) return prose;
    const base = prose.trim();
    const stop = /[.!?]$/.test(base) ? base : `${base}.`;
    return `${stop} ${missing.map((f) => f.text).join(' ')}`;
}

// ---------------------------------------------------------------------------
// Path-parameter derivation
// ---------------------------------------------------------------------------

/** Surfaces where "the caller's company" is not the owner of the id. */
const NO_COMPANY_SEGMENTS: ReadonlySet<string> = new Set(['public', 'agent', 'portal', 'webhooks', 'mcp', 'unsubscribe', 'client']);
/** Look plural to the suffix rules but are not. */
const NOT_PLURAL: ReadonlySet<string> = new Set(['series', 'species', 'news']);

function singularize(word: string): string | undefined {
    if (!/^[a-z]+$/.test(word) || NOT_PLURAL.has(word)) return undefined;
    if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;
    if (!word.endsWith('s')) return undefined;
    if (word.endsWith('es')) {
        // "types" -> "type", but "statuses", "boxes", "batches", "leaves", "heroes" need a dictionary.
        const before = word.charAt(word.length - 3);
        if ('sxzhvo'.includes(before) || word.length < 5) return undefined;
        return word.slice(0, -1);
    }
    const before = word.charAt(word.length - 2);
    if ('sui'.includes(before) || word.length < 4) return undefined;
    return word.slice(0, -1);
}

/** "Id of the contact. Must belong to the caller's company." — or undefined when the path does not say so safely. */
function derivePathIdDescription(pathTemplate: string): string | undefined {
    const segments = pathTemplate.split('/').filter(Boolean);
    if (segments.filter((s) => s === '{id}').length !== 1) return undefined;
    if (segments.some((s) => NO_COMPANY_SEGMENTS.has(s))) return undefined;
    const prev = segments[segments.indexOf('{id}') - 1];
    if (prev === undefined || prev.startsWith('{') || prev === 'api') return undefined;
    const words = prev.split('-');
    const last = words.pop();
    const singular = last === undefined ? undefined : singularize(last);
    if (singular === undefined) return undefined;
    const entity = [...words, singular].join(' ');
    return `Id of the ${entity}. Must belong to the caller's company.`;
}

// ---------------------------------------------------------------------------
// Walk
// ---------------------------------------------------------------------------

interface Ctx {
    schemas: Json | undefined;
    seen: Set<string>;
}

function enrichNode(node: Json, name: string | undefined): void {
    const d = node['description'];
    if (!isSemantic(d)) return;
    const next = appendFacts(d, allFacts(node, name));
    if (next !== d) node['description'] = next;
}

function walkSchema(node: unknown, name: string | undefined, ctx: Ctx): void {
    if (!isRec(node)) return;
    const ref = node['$ref'];
    if (typeof ref === 'string') {
        if (!ref.startsWith(COMPONENT_PREFIX)) return;
        const target = ref.slice(COMPONENT_PREFIX.length);
        if (ctx.seen.has(target)) return;
        ctx.seen.add(target);
        walkSchema(ctx.schemas?.[target], undefined, ctx);
        return;
    }
    enrichNode(node, name);
    const properties = node['properties'];
    if (isRec(properties)) for (const [key, sub] of Object.entries(properties)) walkSchema(sub, key, ctx);
    walkSchema(node['items'], undefined, ctx);
    walkSchema(node['additionalProperties'], undefined, ctx);
    for (const key of ['allOf', 'anyOf', 'oneOf']) {
        const variants = node[key];
        if (Array.isArray(variants)) for (const v of variants) walkSchema(v, undefined, ctx);
    }
}

function enrichParameter(param: unknown, pathTemplate: string, ctx: Ctx): void {
    if (!isRec(param) || typeof param['name'] !== 'string') return;
    const name = param['name'];
    const schema = isRec(param['schema']) ? param['schema'] : undefined;
    const description = param['description'];

    // The schema first: a description derived below must not then be enriched.
    if (schema) walkSchema(schema, name, ctx);
    if (isSemantic(description)) {
        param['description'] = appendFacts(description, allFacts(schema ?? {}, name));
    } else if (isPlaceholderDescription(description) && param['in'] === 'path' && name === 'id') {
        const derived = derivePathIdDescription(pathTemplate);
        if (derived !== undefined) {
            param['description'] = derived;
            if (schema && isPlaceholderDescription(schema['description'])) schema['description'] = derived;
        }
    }
}

function enrichOperation(op: unknown, pathTemplate: string, ctx: Ctx): void {
    if (!isRec(op)) return;
    const parameters = op['parameters'];
    if (Array.isArray(parameters)) for (const p of parameters) enrichParameter(p, pathTemplate, ctx);
    const body = op['requestBody'];
    const content = isRec(body) ? body['content'] : undefined;
    if (isRec(content)) for (const media of Object.values(content)) if (isRec(media)) walkSchema(media['schema'], undefined, ctx);
}

const OPERATION_KEYS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options'] as const;

/**
 * Returns a copy of `doc` whose input descriptions carry schema-derived facts.
 * Only request inputs are touched: parameters, request bodies, and the
 * `components.schemas` those bodies reach through `$ref`.
 */
export function enrichDescriptions<T extends object>(doc: T): T {
    const copy: T = structuredClone(doc);
    const root: unknown = copy;
    if (!isRec(root)) return copy;
    const components = root['components'];
    const schemas = isRec(components) && isRec(components['schemas']) ? components['schemas'] : undefined;
    const ctx: Ctx = { schemas, seen: new Set() };
    const paths = root['paths'];
    if (!isRec(paths)) return copy;
    for (const [pathTemplate, item] of Object.entries(paths)) {
        if (!isRec(item)) continue;
        const shared = item['parameters'];
        if (Array.isArray(shared)) for (const p of shared) enrichParameter(p, pathTemplate, ctx);
        for (const method of OPERATION_KEYS) enrichOperation(item[method], pathTemplate, ctx);
    }
    return copy;
}
